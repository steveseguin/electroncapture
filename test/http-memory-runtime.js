'use strict';

// Isolate browser HTTP traffic from media encoding when investigating main-
// process memory growth. Uses local responses and test-only GC, never production GC.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-http-memory-'));
  const env = { ...process.env, HTTP_MEMORY_ARTIFACTS: directory, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = require('node:child_process').spawnSync(process.env.VALIDATION_ELECTRON || require('electron'), [__filename,
    '--multiinstance', '--minimized', '--no-node', '--url=data:text/html,<body>Local HTTP memory fixture</body>'],
  { env, cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true, timeout: 180000 });
  fs.writeFileSync(path.join(directory, 'runtime.log'), (run.stdout || '') + (run.stderr || ''));
  console.log(`HTTP memory artifacts: ${directory}`);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  console.log(JSON.stringify(report));
  assert.equal(run.status, 0, report.error || run.error?.message); assert.equal(report.passed, true);
} else {
  const { app, BrowserWindow } = require('electron');
  app.setAsDefaultProtocolClient = () => false; app.isDefaultProtocolClient = () => true;
  require('node:v8').setFlagsFromString('--expose_gc');
  const collect = require('node:vm').runInNewContext('gc');
  let headers, original;
  app.on('browser-window-created', (_event, window) => {
    const webRequest = window.webContents.session.webRequest;
    original = webRequest.onHeadersReceived.bind(webRequest);
    webRequest.onHeadersReceived = (filter, listener) => { headers = listener; return original(filter, listener); };
  });
  require('../main');
  const report = { electron: process.versions.electron, passed: false, samples: [] };
  const server = require('node:http').createServer((_request, response) => response.end('<!doctype html><body>Local HTTP fixture</body>'));
  const save = () => fs.writeFileSync(path.join(process.env.HTTP_MEMORY_ARTIFACTS, 'result.json'), JSON.stringify(report, null, 2));
  app.whenReady().then(async () => {
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      let window;
      for (let i = 0; i < 200; i++) {
        window = BrowserWindow.getAllWindows()[0]; if (window && !window.webContents.isLoading()) break; await sleep(50);
      }
      assert.ok(window && headers);
      await window.loadURL(`http://127.0.0.1:${server.address().port}/`);
      const sample = async label => { report.samples.push({ label, js: process.memoryUsage(), native: await process.getProcessMemoryInfo() }); save(); };
      const gc = async () => { for (let i = 0; i < 3; i++) { collect(); await sleep(100); } };
      await gc(); await sample('baseline');
      for (const phase of ['headers-enabled', 'headers-disabled', 'headers-restored']) {
        original(phase === 'headers-disabled' ? null : { urls: ['*://*/*'] }, phase === 'headers-disabled' ? null : headers);
        const count = await window.webContents.executeJavaScript(`(async()=>{for(let i=0;i<2000;i++){
          const response=await fetch('/request?sequence='+i);if(!response.ok)throw Error('HTTP fixture failed');await response.text();
        }return 2000;})()`);
        assert.equal(count, 2000);
        await sample(phase); await gc(); await sample(phase + '-after-gc');
      }
      report.passed = true;
    } catch (error) { report.error = error.stack; }
    finally { save(); server.closeAllConnections(); server.close(); app.exit(report.passed ? 0 : 1); }
  });
}
