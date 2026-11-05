'use strict';

// Opt-in macOS keyboard delivery through System Events. Requires Accessibility
// permission. Uses only this test's application process and disposable profile.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
if (!process.versions.electron) {
  assert.equal(process.platform, 'darwin');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-mac-shortcuts-'));
  const env = { ...process.env, SHORTCUT_ARTIFACTS: directory, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = require('node:child_process').spawnSync(require('electron'), [__filename, '--multiinstance', '--no-node',
    '--nodpi', '--no-pin', '--width=640', '--height=360', '--title=Keyboard validation', '--url=data:text/html,<body>Keyboard validation</body>'],
    { cwd: root, env, encoding: 'utf8', timeout: 90000 });
  fs.writeFileSync(path.join(directory, 'runtime.log'), run.stdout + run.stderr);
  console.log('Keyboard artifacts:', directory);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  console.log(JSON.stringify(report));
  assert.equal(run.status, 0, run.error?.message || report.error);
  assert.equal(report.passed, true);
} else {
  const { app, BrowserWindow } = require('electron');
  const exec = require('node:util').promisify(require('node:child_process').execFile);
  app.setAsDefaultProtocolClient = () => false; app.isDefaultProtocolClient = () => true;
  const report = { passed: false, checks: [] };
  const save = () => fs.writeFileSync(path.join(process.env.SHORTCUT_ARTIFACTS, 'result.json'), JSON.stringify(report, null, 2));
  const check = (condition, name) => { assert.ok(condition, name); report.checks.push(name); save(); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, name) => { const end = Date.now() + 8000; while (!await predicate()) { if (Date.now() > end) throw Error('Timed out: ' + name); await sleep(50); } };
  const press = statement => exec('/usr/bin/osascript', ['-e', `tell application "System Events"\nset targetProcess to first application process whose unix id is ${process.pid}\nset frontmost of targetProcess to true\n${statement}\nend tell`]);
  require('../main');
  app.whenReady().then(async () => {
    try {
      await waitFor(() => BrowserWindow.getAllWindows().length === 1, 'initial window');
      const window = BrowserWindow.getAllWindows()[0];
      await waitFor(() => !window.webContents.isLoading(), 'page load');
      window.show(); await press(''); window.focus(); await waitFor(() => window.isFocused(), 'native focus');
      await sleep(1200);
      await press('keystroke "x" using {command down, shift down, option down}');
      await waitFor(() => window.mouseEvent === true, 'click-through enabled');
      check(window.isAlwaysOnTop(), 'native click-through shortcut pins overlay');
      await press('keystroke "x" using {command down, shift down, option down}');
      await waitFor(() => window.mouseEvent === false, 'click-through disabled');
      check(!window.isAlwaysOnTop(), 'native shortcut restores unpinned interactive window');
      await press('key code 36 using {option down}'); await waitFor(() => window.isMaximized(), 'fullscreen shortcut');
      check(true, 'native Alt+Enter maximizes');
      await press('key code 36 using {option down}'); await waitFor(() => !window.isMaximized(), 'fullscreen shortcut exit');
      check(true, 'native Alt+Enter restores');
      await window.webContents.executeJavaScript('window.keyboardEvents=[];window.electronApi.exposeDoSomethingInWebApp(e=>window.keyboardEvents.push(e.data));window.electronApi.updateVersion("validation");');
      await waitFor(() => window.vdonVersion === 'validation', 'version IPC');
      const count = field => window.webContents.executeJavaScript(`window.keyboardEvents.filter(e=>e[${JSON.stringify(field)}]).length`);
      await press('keystroke "m" using {command down}'); await waitFor(async () => await count('mic') === 1, 'mute IPC');
      check(true, 'native mute shortcut reaches isolated page');
      await window.webContents.executeJavaScript('window.electronApi.updatePPT({meta:true,key:"m"})');
      await sleep(200); await press('keystroke "m" using {command down}'); await waitFor(async () => await count('PPT') === 1, 'PPT IPC');
      check(await count('mic') === 1, 'native shared shortcut belongs exclusively to push-to-talk');
      await window.webContents.executeJavaScript('window.electronApi.updatePPT(false)');
      await sleep(200); await press('keystroke "m" using {command down}'); await waitFor(async () => await count('mic') === 2, 'mute restored');
      check(await count('PPT') === 1, 'releasing push-to-talk restores native mute shortcut');
      await window.webContents.executeJavaScript('window.beforeKeyboardReload=true');
      const loaded = new Promise(resolve => window.webContents.once('did-finish-load', resolve));
      await press('keystroke "r" using {command down, shift down, option down}'); await loaded;
      check(await window.webContents.executeJavaScript('typeof window.beforeKeyboardReload === "undefined"'), 'native reload shortcut reloads page');
      report.passed = true; save(); app.quit();
    } catch (error) { report.error = error.stack; save(); console.error(error); app.exit(1); }
  });
}
