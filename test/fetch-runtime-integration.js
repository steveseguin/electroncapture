'use strict';

// Real preload/IPC requests against local HTTP fixtures; no external servers.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-fetch-integration-'));
  const env = { ...process.env, FETCH_ARTIFACTS: directory, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = require('node:child_process').spawnSync(process.env.VALIDATION_ELECTRON || require('electron'), [__filename,
    '--multiinstance', '--minimized', '--no-node', '--url=data:text/html,<body>Fetch lifecycle fixture</body>'],
  { env, cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 120000 });
  fs.writeFileSync(path.join(directory, 'runtime.log'), (run.stdout || '') + (run.stderr || ''));
  console.log(`Fetch integration artifacts: ${directory}`);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  assert.equal(run.status, 0, report.error || run.error?.message);
  assert.equal(report.passed, true);
  console.log(JSON.stringify(report));
} else {
  const { app, BrowserWindow } = require('electron');
  app.setAsDefaultProtocolClient = () => false;
  app.isDefaultProtocolClient = () => true;
  const report = { electron: process.versions.electron, passed: false, checks: [] };
  const requests = new Map();
  const server = require('node:http').createServer((request, response) => {
    const state = { closed: false }; requests.set(request.url, state);
    response.on('close', () => { state.closed = true; });
    if (request.url.startsWith('/pending')) return;
    if (request.url.startsWith('/error')) { response.writeHead(503); response.write('error body'); return; }
    response.writeHead(200, { 'Content-Type': 'multipart/x-mixed-replace; boundary="fixture boundary"' });
    response.write('owner-only-chunk');
  });
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label) => {
    for (let i = 0; i < 200; i++) { if (await predicate()) return; await sleep(30); }
    throw new Error(`Timed out: ${label}`);
  };
  const invoke = (window, method, args) => window.webContents.executeJavaScript(`electronApi[${JSON.stringify(method)}](${JSON.stringify(args)})`);
  const counts = window => Object.fromEntries(['destroyed', 'render-process-gone', 'did-start-navigation'].map(name => [name, window.webContents.listenerCount(name)]));
  require('../main');
  app.whenReady().then(async () => {
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      let first;
      await wait(() => (first = BrowserWindow.getAllWindows()[0]) && !first.webContents.isLoading(), 'first page');
      app.emit('second-instance', {}, [], process.cwd(), { ...first.args, title: 'Fetch peer', t: 'Fetch peer' });
      await wait(() => BrowserWindow.getAllWindows().length === 2, 'second window');
      const second = BrowserWindow.getAllWindows().find(window => window !== first);
      await wait(() => !second.webContents.isLoading(), 'second page');
      const before = counts(first);
      const stream = await invoke(first, 'noCORSFetch', { url: `${base}/stream/owned` });
      assert.equal(stream.ok, true);
      assert.equal(stream.boundary, 'fixture boundary');
      assert.deepEqual(await invoke(second, 'readStreamChunk', stream.streamId), { done: true });
      assert.equal(await invoke(second, 'closeStream', stream.streamId), false);
      const chunk = await invoke(first, 'readStreamChunk', stream.streamId);
      assert.equal(Buffer.from(chunk.value).toString(), 'owner-only-chunk');
      assert.equal(await invoke(first, 'closeStream', stream.streamId), true);
      await wait(() => requests.get('/stream/owned').closed, 'owner close aborts transport');
      assert.deepEqual(counts(first), before);
      report.checks.push('real cross-window read/close denied while owning renderer retains its stream');

      await first.webContents.executeJavaScript(`window.pendingFetch = electronApi.noCORSFetch({url:${JSON.stringify(`${base}/pending/reload`)}}); void 0;`);
      await wait(() => requests.has('/pending/reload'), 'pending headers request');
      const loaded = new Promise(resolve => first.webContents.once('did-finish-load', resolve));
      first.webContents.reload(); await loaded;
      await wait(() => requests.get('/pending/reload').closed, 'reload aborts pending headers');
      assert.deepEqual(counts(first), before);
      report.checks.push('reload aborts request before headers and removes owner listeners');

      const closing = await invoke(second, 'noCORSFetch', { url: `${base}/stream/destroy` });
      await invoke(second, 'readStreamChunk', closing.streamId);
      await second.webContents.executeJavaScript(`window.pendingRead = electronApi.readStreamChunk(${JSON.stringify(closing.streamId)}).catch(()=>{}); void 0;`);
      second.close();
      await wait(() => second.isDestroyed() && requests.get('/stream/destroy').closed, 'close aborts pending reader');
      report.checks.push('window close releases a pending stream reader and HTTP connection');

      const error = await invoke(first, 'noCORSFetch', { url: `${base}/error/status` });
      assert.equal(error.ok, false); assert.equal(error.status, 503);
      await wait(() => requests.get('/error/status').closed, 'non-success body canceled');
      const malformed = await invoke(first, 'noCORSFetch', { url: 'not a valid URL' });
      assert.equal(malformed.ok, false);
      assert.deepEqual(counts(first), before);
      report.checks.push('HTTP errors and malformed URLs release listeners and response bodies');

      for (let i = 0; i < 100; i++) {
        const current = await invoke(first, 'noCORSFetch', { url: `${base}/stream/repeat-${i}` });
        assert.equal(current.ok, true);
        assert.equal(Buffer.from((await invoke(first, 'readStreamChunk', current.streamId)).value).toString(), 'owner-only-chunk');
        assert.equal(await invoke(first, 'closeStream', current.streamId), true);
        assert.deepEqual(counts(first), before, `listener cleanup ${i}`);
      }
      await wait(() => [...requests.values()].every(request => request.closed), 'all fixture connections close');
      report.connections = requests.size;
      report.listenersBefore = before; report.listenersAfter = counts(first);
      report.checks.push('100 repeated stream lifecycles leave no owner listeners or fixture connections');
      report.passed = true;
    } catch (error) { report.error = error.stack; console.error(error); }
    finally {
      server.closeAllConnections(); server.close();
      fs.writeFileSync(path.join(process.env.FETCH_ARTIFACTS, 'result.json'), JSON.stringify(report, null, 2));
      app.exit(report.passed ? 0 : 1);
    }
  });
}
