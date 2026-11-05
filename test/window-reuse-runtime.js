'use strict';

// Opt-in real Electron checks for named-window reuse and cross-window fetch IPC.
// Uses disposable profiles and a local HTTP server, without external services.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  (async () => {
    const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-reuse-runtime-'));
    const active = new Set();
    const server = require('node:http').createServer((request, response) => {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/state') { response.end(JSON.stringify([...active])); return; }
      if (url.pathname === '/missing') { response.writeHead(404); response.end('missing'); return; }
      if (url.pathname === '/empty') { response.writeHead(204); response.end(); return; }
      if (url.pathname === '/stream' || url.pathname === '/pending') {
        const key = url.searchParams.get('key'); active.add(key);
        let timer;
        response.on('close', () => { clearInterval(timer); active.delete(key); });
        if (url.pathname === '/stream') {
          response.writeHead(200, { 'Content-Type': 'multipart/mixed; boundary="capture"' });
          response.write('first chunk'); timer = setInterval(() => response.write('next chunk'), 100);
        }
        return;
      }
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><body><script>document.body.dataset.page=location.pathname;</script></body>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const env = { ...process.env, REUSE_ARTIFACTS: directory, REUSE_BASE_URL: base,
        ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = require('node:child_process').spawn(process.env.VALIDATION_ELECTRON || require('electron'),
        [__filename, '--multiinstance', '--no-node', '--nodpi', '--no-pin', '--width=640', '--height=360',
          '--windowName=reuse-test', '--title=Initial title', `--url=${base}/initial`], { cwd: root, env });
      let output = '';
      const log = fs.createWriteStream(path.join(directory, 'runtime.log'));
      child.stdout.pipe(log); child.stderr.pipe(log);
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
      const timeout = setTimeout(() => child.kill('SIGKILL'), 180000);
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      clearTimeout(timeout); log.end();
      const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
      console.log(`Reuse/fetch artifacts: ${directory}`);
      console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, failures: report.failures, error: report.error }));
      assert.equal(code, 0);
      assert.ok(report.passed && !/uncaughtException|Object has been destroyed|MaxListenersExceededWarning/.test(output));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, screen } = require('electron');
  app.setAsDefaultProtocolClient = () => false; app.isDefaultProtocolClient = () => true;
  const base = process.env.REUSE_BASE_URL;
  const report = { passed: false, checks: [], failures: [] };
  const save = () => fs.writeFileSync(path.join(process.env.REUSE_ARTIFACTS, 'result.json'), JSON.stringify(report, null, 2));
  const check = (condition, name) => { (condition ? report.checks : report.failures).push(name); save(); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, name) => {
    const end = Date.now() + 12000;
    while (!await predicate()) { if (Date.now() > end) throw new Error(`Timed out: ${name}`); await sleep(50); }
  };
  const ready = window => !window.webContents.isLoading() && window.webContents.executeJavaScript('typeof window.electronApi === "object"');
  const invoke = (window, name, value) => window.webContents.executeJavaScript(`window.electronApi[${JSON.stringify(name)}](${JSON.stringify(value)})`);
  const active = async key => (await (await fetch(`${base}/state`)).json()).includes(key);
  require('../main');
  app.whenReady().then(async () => {
    try {
      await waitFor(() => BrowserWindow.getAllWindows().length === 1, 'initial window');
      const first = BrowserWindow.getAllWindows()[0]; await waitFor(() => ready(first), 'initial preload');
      const request = patch => app.emit('second-instance', {}, [], root, { ...first.args,
        min: false, minimized: false, fullscreen: false, f: false, ...patch });
      const scale = screen.getDisplayMatching(first.getBounds()).scaleFactor;
      for (let index = 0; index < 12; index++) {
        const url = `${base}/page-${index}`, title = `Reused title ${index}`;
        const width = index % 2 ? 800 : 640, height = index % 2 ? 450 : 360, pin = index % 2 === 0;
        if (index % 2) first.hide(); else first.minimize();
        request({ url, u: url, title, t: title, width, w: width, height, h: height, pin, p: pin });
        await waitFor(() => ready(first) && first.webContents.getURL() === url && first.isVisible() && !first.isMinimized(), 'reuse navigation');
        check(BrowserWindow.getAllWindows().length === 1, `reuse ${index}: no duplicate`);
        check(first.getTitle() === title, `reuse ${index}: updated title`);
        check(first.getSize()[0] === Math.round(width / scale) && first.getSize()[1] === Math.round(height / scale), `reuse ${index}: dimensions`);
        check(first.isAlwaysOnTop() === pin, `reuse ${index}: pin choice`);
      }
      first.close(); request({ title: 'Recovered close', t: 'Recovered close' });
      await sleep(2500);
      check(!first.isDestroyed() && first.isVisible() && BrowserWindow.getAllWindows().length === 1, 'reuse cancels pending close timers');
      request({ windowName: 'fetch-other', title: 'Other owner', t: 'Other owner' });
      await waitFor(() => BrowserWindow.getAllWindows().length === 2, 'second owner');
      const second = BrowserWindow.getAllWindows().find(window => window !== first); await waitFor(() => ready(second), 'second preload');
      const listeners = first.webContents.listenerCount('did-start-navigation');
      for (let index = 0; index < 20; index++) {
        const key = `owner-${index}`;
        const opened = await invoke(first, 'noCORSFetch', { url: `${base}/stream?key=${key}` });
        check(opened.ok && opened.boundary === 'capture', `fetch ${index}: quoted boundary`);
        check((await invoke(second, 'readStreamChunk', opened.streamId)).done === true, `fetch ${index}: other window cannot read`);
        check(await invoke(second, 'closeStream', opened.streamId) === false, `fetch ${index}: other window cannot close`);
        const chunk = await invoke(first, 'readStreamChunk', opened.streamId);
        check(!chunk.done && Buffer.from(chunk.value).toString().startsWith('first chunk'), `fetch ${index}: owner reads`);
        await invoke(first, 'closeStream', opened.streamId); await waitFor(async () => !await active(key), 'owner cancellation');
      }
      check(first.webContents.listenerCount('did-start-navigation') === listeners, 'stream owners release navigation listeners');
      const empty = await invoke(first, 'noCORSFetch', { url: `${base}/empty` });
      check(empty.ok && (await invoke(first, 'readStreamChunk', empty.streamId)).done, 'empty response completes');
      check((await invoke(first, 'noCORSFetch', { url: `${base}/missing` })).status === 404, 'HTTP errors preserve status');
      await invoke(first, 'noCORSFetch', { url: `${base}/stream?key=navigate` });
      await first.loadURL(`${base}/after-navigation`); await waitFor(async () => !await active('navigate'), 'navigation cancels stream');
      check(true, 'navigation cancels live network stream'); await waitFor(() => ready(first), 'new preload');
      const pending = invoke(first, 'noCORSFetch', { url: `${base}/pending?key=pending` }).catch(() => null);
      await waitFor(() => active('pending'), 'pending request started');
      await first.loadURL(`${base}/after-pending`); await waitFor(async () => !await active('pending'), 'pending request cancelled');
      await pending; check(true, 'navigation cancels request before headers');
      await invoke(second, 'noCORSFetch', { url: `${base}/stream?key=destroy` });
      second.destroy(); await waitFor(async () => !await active('destroy'), 'destroy cancels stream');
      check(true, 'window destruction cancels its stream');
      if (process.platform === 'darwin') {
        first.setFullScreen(true); await waitFor(() => first.isFullScreen(), 'native fullscreen entry'); await sleep(700);
        request({ fullscreen: true, f: true }); await sleep(700);
        check(first.isFullScreen(), 'reuse preserves requested native fullscreen');
        request({ width: 640, w: 640, height: 360, h: 360 });
        await waitFor(() => !first.isFullScreen(), 'reuse leaves fullscreen'); await sleep(700);
        check(first.getSize()[0] === Math.round(640 / scale) && first.getSize()[1] === Math.round(360 / scale), 'reuse resizes after native fullscreen');
        first.setFullScreen(true); await waitFor(() => first.isFullScreen(), 'second native fullscreen entry'); await sleep(700);
        request({ width: 800, w: 800, height: 450, h: 450 });
        request({ width: 640, w: 640, height: 360, h: 360 });
        await waitFor(() => !first.isFullScreen(), 'rapid reuse leaves fullscreen'); await sleep(700);
        check(first.getSize()[0] === Math.round(640 / scale) && first.getSize()[1] === Math.round(360 / scale), 'latest reuse size wins during fullscreen exit');
      }
      report.passed = report.failures.length === 0; save();
      app.quit(); app.quit();
    } catch (error) { report.error = error.stack; save(); console.error(error); app.exit(1); }
  });
}
