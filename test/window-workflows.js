'use strict';

// Opt-in native integration: npm run test:window-workflows. Requires a desktop.
// Uses the real main process, menus, shortcuts and renderer, with local fixtures.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const scenarios = {
  default: [],
  unpinned: ['--no-pin'],
  pinned: ['--pin'],
  minimized: ['--minimized'],
  'minimized-unpinned': ['--minimized', '--no-pin'],
  clickthrough: ['--unclickable'],
  node: ['--node'],
  chroma: ['--chroma=00ff00'],
  fullscreen: ['--fullscreen'],
  'minimized-clickthrough': ['--minimized', '--unclickable'],
  'minimized-unpinned-clickthrough': ['--minimized', '--no-pin', '--unclickable'],
  'pinned-clickthrough': ['--pin', '--unclickable'],
  'unpinned-clickthrough': ['--no-pin', '--unclickable'],
};

if (!process.versions.electron) {
  (async () => {
    const artifacts = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-window-workflows-'));
    console.log(`Window workflow artifacts: ${artifacts}`);
    const page = path.join(artifacts, 'page.html');
    fs.writeFileSync(page, '<!doctype html><style>html,body{margin:0;width:100%;height:100%}' +
      '#opaque{position:absolute;left:40px;top:40px;width:30px;height:30px;background:red}' +
      '#half{position:absolute;left:90px;top:40px;width:30px;height:30px;background:rgba(0,0,255,.5)}</style>' +
      '<div id="opaque"></div><div id="half"></div>');
    fs.writeFileSync(path.join(artifacts, 'fixture.js'), 'window.workflowInjected = true;');
    fs.writeFileSync(path.join(artifacts, 'fixture.css'), 'body { --workflow-css: loaded; }');
    const results = [];
    for (const [name, flags] of Object.entries(scenarios)) {
      const directory = path.join(artifacts, name);
      fs.mkdirSync(directory);
      const env = { ...process.env, WORKFLOW_SCENARIO: name, WORKFLOW_ARTIFACTS: directory,
        ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = require('node:child_process').spawn(require('electron'), [__filename,
        '--multiinstance', '--nodpi', '--width=640', '--height=360', '--title=Workflow validation', '--windowName=workflow',
        `--url=${pathToFileURL(page).href}`, `--js=${path.join(artifacts, 'fixture.js')}`,
        `--css=${path.join(artifacts, 'fixture.css')}`, ...flags], { cwd: root, env });
      let output = '';
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 90000);
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
      clearTimeout(timer);
      fs.writeFileSync(path.join(directory, 'runtime.log'), output);
      const reportFile = path.join(directory, 'result.json');
      const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile)) : {};
      const passed = code === 0 && report.passed === true &&
        !/uncaughtException|Object has been destroyed|MaxListenersExceededWarning/.test(output);
      results.push({ name, exitCode: code, ...report, passed });
      console.log(`${name}: ${passed ? 'PASS' : 'FAIL'} (${report.checks?.length || 0} checks)`);
      if (!passed) console.error(report.error || output.slice(-4000));
    }
    fs.writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify(results, null, 2));
    assert.ok(results.every(result => result.passed), 'Some native window workflows failed');
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, globalShortcut, screen, ipcMain } = require('electron');
  const directory = process.env.WORKFLOW_ARTIFACTS;
  const scenario = process.env.WORKFLOW_SCENARIO;
  const report = { scenario, versions: process.versions, checks: [], passed: false };
  const save = () => fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
  const check = (condition, name) => { assert.ok(condition, name); report.checks.push(name); save(); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(predicate, name) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await sleep(50);
    }
    throw new Error(`Timed out: ${name}`);
  }
  const ready = win => !win.webContents.isLoading() && win.webContents.executeJavaScript(
    'window.workflowInjected === true && getComputedStyle(document.body).getPropertyValue("--workflow-css").trim() === "loaded"');

  app.setAsDefaultProtocolClient = () => false;
  app.isDefaultProtocolClient = () => true;
  if (scenario.startsWith('minimized')) {
    report.windowEvents = [];
    app.on('browser-window-created', (_event, window) => {
      for (const event of ['minimize', 'restore', 'show', 'focus', 'always-on-top-changed']) {
        window.on(event, () => {
          report.windowEvents.push({ event, minimized: window.isMinimized(), pinned: window.isAlwaysOnTop(), visible: window.isVisible() });
        });
      }
    });
  }
  // Capture the app's menu and shortcut callbacks while still registering them
  // with the real native APIs. No production window operations are stubbed.
  const callbacks = new Map();
  const register = globalShortcut.register.bind(globalShortcut);
  const unregister = globalShortcut.unregister.bind(globalShortcut);
  globalShortcut.register = (key, callback) => {
    const registered = register(key, callback);
    if (registered) callbacks.set(key, callback);
    return registered;
  };
  globalShortcut.unregister = key => { callbacks.delete(key); return unregister(key); };
  const menuModule = require.resolve('electron-context-menu');
  const contextMenu = require(menuModule);
  let menuOptions;
  require.cache[menuModule].exports = options => { menuOptions = options; return contextMenu(options); };
  const menu = win => menuOptions.prepend({}, { frameURL: win.webContents.getURL(), mediaType: 'none', x: 0, y: 0 }, win);
  function item(win, label) {
    const search = entries => {
      for (const entry of entries) {
        if (entry.label?.includes(label)) return entry;
        if (entry.submenu) { const result = search(entry.submenu); if (result) return result; }
      }
    };
    const result = search(menu(win));
    assert.ok(result, `Menu item ${label} exists`);
    return result;
  }

  require('../main');
  app.whenReady().then(async () => {
    try {
      await waitFor(() => BrowserWindow.getAllWindows().length === 1, 'initial window');
      const win = BrowserWindow.getAllWindows()[0];
      await waitFor(() => ready(win), 'page and injections');
      check(true, 'local URL and CSS/JavaScript injections load');
      const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor;
      const size = win.getSize();
      if (scenario === 'fullscreen') {
        check(win.isMaximized() || win.isFullScreen(), 'CLI fullscreen startup');
      } else {
        check(size[0] === Math.floor(640 / scale) && size[1] === Math.floor(360 / scale), 'CLI physical dimensions');
      }
      check(win.webContents.getZoomFactor() === 1, 'nodpi preserves normal page zoom');
      const expectedPin = !!win.args.pin;
      if (!scenario.startsWith('minimized')) {
        check(win.isAlwaysOnTop() === expectedPin, 'initial pin state');
      }
      check(win.webContents.getLastWebPreferences().nodeIntegration === (scenario === 'node'), 'Node integration opt-in');
      check(win.webContents.getLastWebPreferences().contextIsolation === (scenario !== 'node'), 'context isolation matches mode');
      check(win.webContents.backgroundThrottling === false, 'background capture is not throttled');
      if (scenario.startsWith('minimized')) {
        await waitFor(() => win.isMinimized(), 'starts minimized');
        check(true, 'CLI starts minimized');
        if (process.platform === 'darwin') {
          await waitFor(() => app.dock.isVisible(), 'Dock entry for minimized window');
          check(true, 'minimized window has a Dock restore entry');
        }
        app.emit('activate');
        await waitFor(() => !win.isMinimized() && win.isVisible(), 'Dock activation restores minimized window');
        check(true, 'Dock activation restores minimized window');
        await waitFor(() => win.isAlwaysOnTop() === expectedPin, 'pin restored after minimize animation');
        check(true, 'pin survives initial minimize/restore');
      } else {
        await waitFor(() => win.isVisible(), 'starts visible');
        check(true, 'window starts visible');
      }
      if (scenario.includes('clickthrough')) {
        check(win.mouseEvent === true, 'CLI click-through survives initial focus');
        await sleep(1100);
        callbacks.get('CommandOrControl+Shift+Alt+X')();
        check(win.mouseEvent === false, 'shortcut restores mouse interaction');
        check(win.isAlwaysOnTop() === expectedPin, 'leaving click-through preserves the chosen pin state');
        callbacks.get('CommandOrControl+Shift+Alt+X')();
        check(win.mouseEvent === true && win.isAlwaysOnTop(), 'shortcut explicitly pins click-through overlay');
        callbacks.get('CommandOrControl+Shift+Alt+X')();
        check(win.mouseEvent === false && win.isAlwaysOnTop() === expectedPin, 'shortcut restores original pin choice');
      }
      if (scenario === 'chroma') {
        check(await win.webContents.executeJavaScript('getComputedStyle(document.body).backgroundColor === "rgb(0, 255, 0)"'), 'chroma background injected');
      }
      if (scenario === 'unpinned' || scenario === 'pinned') {
        win.minimize();
        await waitFor(() => win.isMinimized(), 'native minimize');
        if (process.platform === 'darwin') await waitFor(() => app.dock.isVisible(), 'Dock ready');
        win.restore(); win.show();
        await waitFor(() => !win.isMinimized() && win.isVisible() && win.isAlwaysOnTop() === expectedPin, 'native restore preserves pin');
        check(true, 'native restore preserves chosen pin state');
      }
      if (scenario === 'default') {
        const initialPin = win.isAlwaysOnTop();
        item(win, 'Always on top').click();
        check(win.isAlwaysOnTop() !== initialPin && win.args.pin === !initialPin, 'menu changes pin and stored preference');
        item(win, 'Always on top').click();
        check(win.isAlwaysOnTop() === initialPin, 'menu restores pin');
        win.hide();
        check(!win.isVisible(), 'hide removes the capture window');
        app.emit('activate');
        await waitFor(() => win.isVisible(), 'show after hide');
        check(win.isAlwaysOnTop() === initialPin, 'app activation restores hidden window and pin');
        item(win, 'Make UnClickable').click();
        check(win.mouseEvent === true, 'menu enables click-through');
        callbacks.get('CommandOrControl+Shift+Alt+X')();
        check(win.mouseEvent === false, 'global shortcut disables click-through');
        item(win, 'Hide cursor').click();
        await waitFor(() => win.webContents.executeJavaScript('getComputedStyle(document.body).cursor.includes("data:image/png")'), 'hide cursor');
        check(true, 'hide cursor applied');
        item(win, 'Hide cursor').click();
        await waitFor(() => win.webContents.executeJavaScript('!getComputedStyle(document.body).cursor.includes("data:image/png")'), 'restore cursor');
        check(true, 'cursor restored');
        item(win, 'Fullscreen (Alt+Enter)').click();
        await waitFor(() => win.isMaximized() || win.isFullScreen(), 'fullscreen/maximize');
        check(true, 'fullscreen menu enters supported platform mode');
        item(win, '640x360').click();
        await waitFor(() => !win.isMaximized() && !win.isFullScreen() && win.getSize()[0] === Math.round(640 / scale), 'resize exits fullscreen');
        check(true, 'resolution menu exits fullscreen and restores dimensions');
        await sleep(200);
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(directory, 'alpha.png'), image.toPNG());
        const bitmap = image.toBitmap();
        const dimensions = image.getSize();
        const bitmapScale = Math.sqrt(bitmap.length / 4 / dimensions.width / dimensions.height);
        const width = Math.round(dimensions.width * bitmapScale);
        const ratio = width / await win.webContents.executeJavaScript('window.innerWidth');
        const pixel = (x, y) => [...bitmap.subarray((Math.round(y * ratio) * width + Math.round(x * ratio)) * 4,
          (Math.round(y * ratio) * width + Math.round(x * ratio)) * 4 + 4)];
        report.alphaPixels = { empty: pixel(10, 100), opaque: pixel(50, 50), half: pixel(100, 50) };
        check(report.alphaPixels.empty[3] === 0, 'transparent page retains zero alpha');
        check(report.alphaPixels.opaque[3] === 255, 'opaque overlay retains full alpha');
        check(Math.abs(report.alphaPixels.half[3] - 128) <= 1, 'translucent overlay retains half alpha');
        win.minimize();
        await waitFor(() => win.isMinimized(), 'minimize');
        check(true, 'native minimize');
        if (process.platform === 'darwin') {
          await waitFor(() => app.dock.isVisible(), 'Dock entry after minimize');
          check(true, 'minimized window remains recoverable from Dock');
        }
        app.emit('activate');
        await waitFor(() => !win.isMinimized() && win.isVisible(), 'activate restores');
        check(true, 'app activation restores minimized capture');
        const loaded = new Promise(resolve => win.webContents.once('did-finish-load', resolve));
        item(win, 'Reload (').click();
        await loaded; await waitFor(() => ready(win), 'reload injections');
        check(win.isAlwaysOnTop() === initialPin, 'reload preserves pin and injections');
        win.hide();
        app.emit('second-instance', {}, [], root, { ...win.args, min: false, minimized: false });
        await waitFor(() => win.isVisible() && ready(win), 'reuse named hidden window');
        check(BrowserWindow.getAllWindows().length === 1 && win.isAlwaysOnTop() === initialPin, 'named window reuse restores visibility and pin without duplication');
        app.emit('second-instance', {}, [], root, { ...win.args, windowName: 'secondary', title: 'Second validation', t: 'Second validation', min: false, minimized: false });
        await waitFor(() => BrowserWindow.getAllWindows().length === 2, 'second window');
        const second = BrowserWindow.getAllWindows().find(other => other !== win);
        await waitFor(() => ready(second), 'second page');
        item(second, 'Always on top').click();
        check(win.isAlwaysOnTop() === initialPin && second.isAlwaysOnTop() !== initialPin, 'pin changes are window-specific');
        item(second, 'Close').click();
        await waitFor(() => second.isDestroyed(), 'close secondary');
        check(!win.isDestroyed() && win.isVisible(), 'closing secondary preserves first window');
        const pong = [];
        const send = win.webContents.send.bind(win.webContents);
        win.webContents.send = (channel, payload) => { if (channel === 'postMessage') pong.push(payload); return send(channel, payload); };
        ipcMain.emit('PPTHotkey', { sender: win.webContents }, { meta: process.platform === 'darwin', ctrl: process.platform !== 'darwin', key: 'm' });
        callbacks.get('CommandOrControl+M')();
        check(pong.some(message => message.PPT === true), 'push-to-talk takes ownership of shared mute shortcut');
        ipcMain.emit('PPTHotkey', { sender: win.webContents }, false);
      }
      report.passed = true; save();
      console.log('WINDOW_WORKFLOWS_PASSED');
      app.quit(); app.quit();
    } catch (error) {
      report.error = error.stack; save();
      console.error(error); app.exit(1);
    }
  });
}
