'use strict';

// Real renderer/preload/IPC/Undici integration, using only a local HTTP fixture.
// Opt-in: npm run test:fetch-runtime (requires a desktop; supports all platforms).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-fetch-runtime-'));
  const env = { ...process.env, FETCH_RUNTIME_ARTIFACTS: directory,
    ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(process.env.VALIDATION_ELECTRON || require('electron'),
    [__filename, '--multiinstance', '--no-node', '--nodpi', '--password-store=basic',
      '--url=data:text/html,<body>Local fetch fixture</body>'],
    { cwd: root, env, encoding: 'utf8', timeout: 120000 });
  const output = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(directory, 'runtime.log'), output);
  console.log(`Fetch runtime artifacts: ${directory}`);
  assert.equal(result.status, 0, result.error?.message || output.slice(-8000));
  assert.doesNotMatch(output, /uncaughtException|Object has been destroyed|MaxListenersExceededWarning/);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  assert.equal(report.passed, true);
  console.log(`Fetch runtime passed (${report.checks.length} checks); Electron ${report.electron}`);
} else {
  const { app, BrowserWindow } = require('electron');
  const active = new Set();
  const directory = process.env.FETCH_RUNTIME_ARTIFACTS;
  const report = { electron: process.versions.electron, passed: false, checks: [] };
  const bytes = Buffer.from('fixture\u0000\u00ff\ud83d\ude00');
  const save = () => fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
  const check = (condition, name) => { assert.ok(condition, name); report.checks.push(name); save(); };
  const waitFor = async (predicate, name) => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out: ${name}`);
  };
  const server = require('node:http').createServer((request, response) => {
    const route = new URL(request.url, 'http://localhost').pathname;
    if (route === '/slow' || route === '/pending') {
      active.add(request.url);
      let timer;
      if (route === '/slow') {
        response.writeHead(200, { 'content-type': 'multipart/mixed; boundary="frame"' });
        response.write('first');
        timer = setInterval(() => response.write('next'), 25);
      }
      response.once('close', () => { clearInterval(timer); active.delete(request.url); });
    } else if (route === '/error') {
      response.writeHead(503); response.end('unavailable');
    } else if (route === '/empty') {
      response.writeHead(204); response.end();
    } else if (route === '/broken') {
      response.writeHead(200, { 'content-length': 100 }); response.write('short');
      setTimeout(() => response.destroy(), 30);
    } else {
      response.writeHead(200, { 'content-type': 'application/octet-stream' }); response.end(bytes);
    }
  });
  app.setAsDefaultProtocolClient = () => false;
  app.isDefaultProtocolClient = () => true;
  require('../main');
  app.whenReady().then(async () => {
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      await waitFor(() => BrowserWindow.getAllWindows().length === 1, 'initial window');
      const first = BrowserWindow.getAllWindows()[0];
      const ready = win => !win.webContents.isLoading() && win.webContents.executeJavaScript('typeof window.electronApi === "object"');
      await waitFor(() => ready(first), 'preload bridge');
      app.emit('second-instance', {}, [], root, { ...first.args, title: 'Second fetch fixture', t: 'Second fetch fixture' });
      await waitFor(() => BrowserWindow.getAllWindows().length === 2, 'second window');
      const second = BrowserWindow.getAllWindows().find(win => win !== first);
      await waitFor(() => ready(second), 'second preload bridge');
      const call = (win, method, arg) => win.webContents.executeJavaScript(
        `window.electronApi[${JSON.stringify(method)}](${JSON.stringify(arg)})`);
      const fetch = (win, route) => call(win, 'noCORSFetch', { url: base + route });
      const events = ['destroyed', 'render-process-gone', 'did-start-navigation'];
      const listeners = () => events.map(event => first.webContents.listenerCount(event));
      const baseline = listeners();
      check(await first.webContents.executeJavaScript('typeof require === "undefined"'), 'default renderer stays isolated');
      const finite = await fetch(first, '/finite');
      const received = [];
      for (;;) {
        const chunk = await call(first, 'readStreamChunk', finite.streamId);
        if (chunk.done) break;
        received.push(...chunk.value);
      }
      check(Buffer.from(received).equals(bytes), 'binary response survives real IPC without encoding loss');
      check(JSON.stringify(listeners()) === JSON.stringify(baseline), 'completed stream releases lifecycle listeners');
      const slow = await fetch(first, '/slow?owner');
      check(slow.boundary === 'frame', 'quoted multipart boundary reaches the renderer');
      check((await call(second, 'readStreamChunk', slow.streamId)).done === true, 'another renderer cannot consume owner stream');
      check(await call(second, 'closeStream', slow.streamId) === false, 'another renderer cannot cancel owner stream');
      check((await call(first, 'readStreamChunk', slow.streamId)).value.length > 0, 'owner stream survives foreign access');
      await first.webContents.executeJavaScript('location.hash = "in-place"');
      check((await call(first, 'readStreamChunk', slow.streamId)).done === false, 'in-page navigation preserves stream');
      await call(first, 'closeStream', slow.streamId);
      await waitFor(() => active.size === 0, 'explicit close releases HTTP connection');
      check(true, 'explicit close releases HTTP connection');
      check((await fetch(first, '/error')).status === 503, 'HTTP error remains a structured failure');
      const empty = await fetch(first, '/empty');
      check(empty.ok && (await call(first, 'readStreamChunk', empty.streamId)).done, '204 response has no leaked reader');
      const broken = await fetch(first, '/broken');
      let rejected = false;
      for (let i = 0; i < 10; i++) {
        try { if ((await call(first, 'readStreamChunk', broken.streamId)).done) break; }
        catch { rejected = true; break; }
      }
      check(rejected, 'truncated response rejects through IPC without crashing');
      const corpus = [null, false, 0, '', [], {}, { url: null }, { url: [] },
        { url: 'not a URL' }, { url: 'http://[' }, { url: base, method: 'BAD METHOD' },
        { url: base, headers: { bad: 'line\r\nbreak' } }];
      for (const [index, input] of corpus.entries()) {
        const result = await call(first, 'noCORSFetch', input);
        check(result.ok === false && typeof result.error === 'string', `malformed input ${index} fails safely`);
      }
      const batch = await Promise.all(Array.from({ length: 40 }, (_, i) => fetch(first, `/slow?batch=${i}`)));
      check(new Set(batch.map(result => result.streamId)).size === 40, '40 concurrent streams have independent IDs');
      check(listeners().every((count, i) => count === baseline[i] + 1), 'concurrent streams share one lifecycle listener per event');
      await Promise.all(batch.map(result => call(first, 'closeStream', result.streamId)));
      await waitFor(() => active.size === 0, 'batch cancellation');
      check(JSON.stringify(listeners()) === JSON.stringify(baseline), 'batch cancellation releases all listeners and HTTP connections');
      for (let cycle = 0; cycle < 5; cycle++) {
        await fetch(first, `/slow?reload=${cycle}`);
        await first.webContents.executeJavaScript(`window.pendingFetch = window.electronApi.noCORSFetch({url:${JSON.stringify(base + '/pending?reload=' + cycle)}}); void 0`);
        await waitFor(() => active.size === 2, 'pending request reaches server');
        first.reload();
        await waitFor(() => active.size === 0, 'reload cancels body and pending headers');
        await waitFor(() => ready(first), 'reloaded preload');
        check(JSON.stringify(listeners()) === JSON.stringify(baseline), `reload cycle ${cycle + 1} releases both request phases`);
      }
      await fetch(second, '/slow?closed');
      second.close();
      await waitFor(() => second.isDestroyed() && active.size === 0, 'closed window releases stream');
      check(!first.isDestroyed(), 'closing one streaming window preserves the other');
      await fetch(first, '/slow?crashed');
      first.webContents.forcefullyCrashRenderer();
      await waitFor(() => active.size === 0, 'renderer crash aborts stream');
      first.reload();
      await waitFor(() => ready(first), 'crash recovery');
      const recovered = await fetch(first, '/finite');
      check(recovered.ok && (await call(first, 'readStreamChunk', recovered.streamId)).value.length > 0, 'fetch works after renderer crash and reload');
      await call(first, 'closeStream', recovered.streamId);
      report.passed = true; save();
      server.closeAllConnections(); server.close(); app.quit();
    } catch (error) {
      report.error = error.stack; save(); console.error(error);
      server.closeAllConnections(); server.close(); app.exit(1);
    }
  });
}
