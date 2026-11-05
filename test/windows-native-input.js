'use strict';

// Opt-in interactive desktop test. Briefly moves/restores the mouse inside owned
// fixtures. Refuses native input if another window covers the target. Run alone.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { spawnSync, execFile } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const page = '<!doctype html><style>html,body{margin:0;background:transparent}' +
  '#target{position:absolute;left:80px;top:80px;width:100px;height:80px;background:#f00}' +
  '#right{position:fixed;right:0;top:0;bottom:0;width:16px;background:#f00}' +
  '#bottom{position:fixed;left:0;right:0;bottom:0;height:16px;background:#f00}</style>' +
  '<div id="target"></div><div id="right"></div><div id="bottom"></div>' +
  '<script>window.fixtureClicks=0;document.addEventListener("click",()=>window.fixtureClicks++)</script>';
if (!process.versions.electron) {
  assert.equal(process.platform, 'win32');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-native-input-'));
  fs.writeFileSync(path.join(directory, 'fixture.html'), page);
  const env = { ...process.env, INPUT_ARTIFACTS: directory, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.env.VALIDATION_ELECTRON || require('electron'), [__filename,
    '--multiinstance', '--pin', '--nodpi', '--width=640', '--height=360', '--title=Native input fixture',
    `--url=${pathToFileURL(path.join(directory, 'fixture.html')).href}`],
  { env, cwd: root, encoding: 'utf8', timeout: 120000 });
  fs.writeFileSync(path.join(directory, 'runtime.log'), (result.stdout || '') + (result.stderr || ''));
  console.log(`Native Windows input artifacts: ${directory}`);
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  assert.equal(report.passed, true);
  console.log(JSON.stringify(report));
} else {
  const { app, BrowserWindow, screen } = require('electron');
  app.setAsDefaultProtocolClient = () => false;
  app.isDefaultProtocolClient = () => true;
  const directory = process.env.INPUT_ARTIFACTS;
  const report = { electron: process.versions.electron, passed: false, checks: [] };
  const save = () => fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (test, label) => {
    for (let i = 0; i < 240; i++) { if (await test()) return; await sleep(50); }
    throw new Error(`Timed out: ${label}`);
  };
  const appRequire = require('./fixtures/app-require');
  const menuModule = appRequire.resolve('electron-context-menu');
  const contextMenu = appRequire(menuModule);
  let menuOptions;
  require.cache[menuModule].exports = options => { menuOptions = options; return contextMenu(options); };
  const hwnd = win => Number(win.getNativeWindowHandle().readBigUInt64LE());
  const native = async (win, action, point, end = point) => {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'fixtures/windows-native-input.ps1'),
      '-Action', action, '-WindowHandle', String(hwnd(win)), '-OwnerProcess', String(process.pid),
      '-X', String(point.x), '-Y', String(point.y), '-EndX', String(end.x), '-EndY', String(end.y)];
    const output = await new Promise((resolve, reject) => execFile('powershell.exe', args,
      { windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => error ? reject(new Error(`${error.message}\n${stderr}`)) : resolve(stdout)));
    return JSON.parse(output);
  };
  appRequire('./main');
  app.whenReady().then(async () => {
    let backdrop;
    try {
      let overlay;
      await wait(() => {
        overlay = BrowserWindow.getAllWindows()[0];
        report.startup = BrowserWindow.getAllWindows().map(win => ({ id: win.id, visible: win.isVisible(),
          minimized: win.isMinimized(), loading: win.webContents.isLoading(), url: win.webContents.getURL() }));
        return overlay?.isVisible() && !overlay.webContents.isLoading();
      }, 'overlay ready');
      const area = screen.getPrimaryDisplay().workArea;
      overlay.setPosition(area.x + 120, area.y + 120);
      backdrop = new BrowserWindow({ ...overlay.getBounds(), width: 800, height: 500,
        frame: false, show: false, backgroundColor: '#00ff00', webPreferences: { sandbox: true, contextIsolation: true } });
      await backdrop.loadURL(`data:text/html,${encodeURIComponent(page + '<style>html,body{background:lime}</style>')}`);
      backdrop.setAlwaysOnTop(true); backdrop.showInactive(); overlay.moveTop(); overlay.focus();
      await sleep(400);
      const point = () => { const b = overlay.getContentBounds(); return screen.dipToScreenPoint({ x: b.x + 100, y: b.y + 100 }); };
      const clicks = win => win.webContents.executeJavaScript('fixtureClicks');
      for (let cycle = 0; cycle < 5; cycle++) {
        const overlayBefore = await clicks(overlay), backdropBefore = await clicks(backdrop);
        report.attempt = { cycle, overlayBefore, backdropBefore, point: point(), bounds: overlay.getBounds(), mouseEvent: overlay.mouseEvent };
        report.attempt.input = await native(overlay, 'click', point());
        await sleep(150);
        report.attempt.after = { overlay: await clicks(overlay), backdrop: await clicks(backdrop) }; save();
        await wait(async () => await clicks(overlay) === overlayBefore + 1, 'overlay native click');
        assert.equal(await clicks(backdrop), backdropBefore);
        const entries = menuOptions.prepend({}, { frameURL: overlay.webContents.getURL(), mediaType: 'none', x: 0, y: 0 }, overlay);
        entries.find(item => item.label?.includes('Make UnClickable')).click();
        await sleep(150);
        await native(backdrop, 'click', point());
        await wait(async () => await clicks(backdrop) === backdropBefore + 1, 'click through to backdrop');
        assert.equal(await clicks(overlay), overlayBefore + 1, 'click-through must not deliver to overlay');
        overlay.focus(); overlay.moveTop();
        await wait(() => !overlay.mouseEvent, 'focus restores overlay interaction');
        report.checks.push(`native click/click-through/focus restore cycle ${cycle + 1}`); save();
      }
      const before = overlay.getBounds();
      const right = screen.dipToScreenPoint({ x: before.x + before.width - 2, y: before.y + Math.floor(before.height / 2) });
      const hit = await native(overlay, 'probe', right);
      report.resizeHit = hit; save();
      assert.equal(hit.root, hwnd(overlay), 'resize edge belongs to fixture');
      assert.equal(hit.hit, 11, 'native right-edge hit test must report HTRIGHT');
      await native(overlay, 'drag', right, { x: right.x + 80, y: right.y });
      await wait(() => overlay.getBounds().width > before.width + 20, 'native edge drag resizes transparent window');
      report.resize = { before, after: overlay.getBounds() };
      report.checks.push('native mouse edge drag resizes the transparent frameless window');
      backdrop.destroy(); backdrop = null;
      report.passed = true; save(); app.quit();
    } catch (error) {
      report.error = error.stack; save(); console.error(error);
      if (backdrop && !backdrop.isDestroyed()) backdrop.destroy();
      app.exit(1);
    }
  });
}
