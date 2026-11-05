'use strict';

// Repeated real close cycles, then test-only GC to detect retained window wrappers.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-window-retention-'));
  const env = { ...process.env, RETENTION_ARTIFACTS: directory,
    ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(process.env.VALIDATION_ELECTRON || require('electron'),
    [__filename, '--multiinstance', '--no-node', '--nodpi', '--password-store=basic', '--url=data:text/html,<body>Window retention fixture</body>'],
    { cwd: root, env, encoding: 'utf8', timeout: 200000 });
  const output = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(directory, 'runtime.log'), output);
  console.log(`Window retention artifacts: ${directory}`);
  assert.equal(result.status, 0, result.error?.message || output.slice(-5000));
  assert.doesNotMatch(output, /uncaughtException|Object has been destroyed|MaxListenersExceededWarning/);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  assert.equal(report.passed, true);
  console.log(JSON.stringify(report));
} else {
  const { app, BrowserWindow, ipcMain, screen } = require('electron');
  require('node:v8').setFlagsFromString('--expose_gc');
  const collect = require('node:vm').runInNewContext('gc');
  const report = { passed: false, electron: process.versions.electron, cycles: 20, samples: [] };
  const save = () => fs.writeFileSync(path.join(process.env.RETENTION_ARTIFACTS, 'result.json'), JSON.stringify(report, null, 2));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, name) => {
    const deadline = Date.now() + 10000;
    while (!await predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${name}`);
      await sleep(25);
    }
  };
  app.setAsDefaultProtocolClient = () => false;
  app.isDefaultProtocolClient = () => true;
  require('../main');
  app.whenReady().then(async () => {
    try {
      await waitFor(() => BrowserWindow.getAllWindows().length === 1, 'initial window');
      const first = BrowserWindow.getAllWindows()[0];
      await waitFor(() => !first.webContents.isLoading(), 'initial page');
      const snapshot = () => ({
        ipc: ipcMain.eventNames().map(event => [String(event), ipcMain.listenerCount(event)]).sort(),
        displays: screen.listenerCount('display-metrics-changed'),
        downloads: first.webContents.session.listenerCount('will-download'),
      });
      const baseline = snapshot();
      const references = [];
      async function cycle(index) {
        app.emit('second-instance', {}, [], root, { ...first.args, title: `Retention ${index}`, t: `Retention ${index}` });
        await waitFor(() => BrowserWindow.getAllWindows().length === 2, 'new window');
        const other = BrowserWindow.getAllWindows().find(window => window !== first);
        await waitFor(() => !other.webContents.isLoading(), 'new page');
        const reference = new WeakRef(other);
        other.close();
        await waitFor(() => other.isDestroyed(), 'normal close');
        return reference;
      }
      for (let index = 0; index < report.cycles; index++) {
        references.push(await cycle(index));
        assert.deepEqual(snapshot(), baseline, 'Closed window must release IPC/display/download listeners');
        report.samples.push({ cycle: index + 1, ...process.memoryUsage() });
        save();
      }
      // Let Electron's destruction tasks and V8 weak processing finish between
      // collections. No GC flags are enabled in production or renderer pages.
      for (let attempt = 0; attempt < 6; attempt++) { await sleep(100); collect(); }
      await sleep(100);
      report.retainedClosedWindows = references.filter(reference => reference.deref()).length;
      report.finalMemory = process.memoryUsage();
      save();
      assert.equal(report.retainedClosedWindows, 0, 'Closed BrowserWindow wrappers remain strongly reachable');
      assert.equal(BrowserWindow.getAllWindows().length, 1);
      report.passed = true; save(); app.quit();
    } catch (error) { report.error = error.stack; save(); console.error(error); app.exit(1); }
  });
}
