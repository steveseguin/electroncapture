'use strict';

// Native X11 input/compositor validation. Run on a disposable Xvfb/Openbox
// display with xcompmgr, xdotool and ImageMagick; never on the user's desktop.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const fixture = '<!doctype html><style>html,body{margin:0;background:transparent}' +
  '#opaque{position:absolute;left:40px;top:40px;width:30px;height:30px;background:red}' +
  '#half{position:absolute;left:90px;top:40px;width:30px;height:30px;background:rgba(0,0,255,.5)}' +
  '</style><div id="opaque"></div><div id="half"></div><script>' +
  'window.clicks=0;addEventListener("pointerdown",()=>window.clicks++);</script>';

if (!process.versions.electron) {
  assert.equal(process.platform, 'linux');
  assert.equal(process.env.ELECAP_NATIVE_INPUT, '1', 'Set ELECAP_NATIVE_INPUT=1 only on an isolated test display');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-linux-native-'));
  fs.writeFileSync(path.join(directory, 'page.html'), fixture);
  const env = { ...process.env, NATIVE_WINDOW_ARTIFACTS: directory,
    ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.env.VALIDATION_ELECTRON || require('electron'), [__filename,
    '--multiinstance', '--pin', '--nodpi', '--no-dragbar', '--width=640', '--height=360',
    '--title=Linux native fixture', `--url=${require('node:url').pathToFileURL(path.join(directory, 'page.html'))}`],
  { cwd: root, env, encoding: 'utf8', timeout: 120000 });
  const output = (result.stdout || '') + (result.stderr || '');
  fs.writeFileSync(path.join(directory, 'runtime.log'), output);
  console.log(`Linux native window artifacts: ${directory}`);
  assert.equal(result.status, 0, result.error?.message || output.slice(-8000));
  assert.doesNotMatch(output, /uncaughtException|Object has been destroyed|MaxListenersExceededWarning/);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  assert.equal(report.passed, true);
  console.log(`Native X11 compositor/input passed (${report.checks.length} checks)`);
} else {
  const { app, BrowserWindow, nativeImage } = require('electron');
  const directory = process.env.NATIVE_WINDOW_ARTIFACTS;
  const report = { electron: process.versions.electron, passed: false, checks: [], samples: {} };
  const save = () => fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
  const check = (condition, name) => { assert.ok(condition, name); report.checks.push(name); save(); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async (predicate, name) => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { if (await predicate()) return; await sleep(25); }
    throw new Error(`Timed out: ${name}`);
  };
  const xdo = (...args) => execFileSync('xdotool', args.map(String), { timeout: 5000 });
  app.setAsDefaultProtocolClient = () => false;
  app.isDefaultProtocolClient = () => true;
  require('../main');
  app.whenReady().then(async () => {
    try {
      await waitFor(() => BrowserWindow.getAllWindows().length === 1, 'initial window');
      const overlay = BrowserWindow.getAllWindows()[0];
      await waitFor(() => overlay.isVisible() && !overlay.webContents.isLoading(), 'overlay ready');
      overlay.setPosition(100, 100);
      const backdrop = new BrowserWindow({ ...overlay.getBounds(), frame: false, show: false,
        backgroundColor: '#00ff00', webPreferences: { sandbox: true, contextIsolation: true } });
      const loadBackdrop = body => backdrop.loadURL('data:text/html,' + encodeURIComponent(body));
      const sample = async name => {
        await sleep(400);
        const bounds = overlay.getContentBounds();
        const file = path.join(directory, `${name}.png`);
        execFileSync('import', ['-window', 'root', '-crop', `120x120+${bounds.x}+${bounds.y}`, file], { timeout: 10000 });
        const image = nativeImage.createFromPath(file);
        const bitmap = image.toBitmap();
        const width = image.getSize().width;
        const pixel = (x, y) => [...bitmap.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)];
        const pixels = { empty: pixel(10, 100), opaque: pixel(50, 50), half: pixel(100, 50) };
        report.samples[name] = pixels; save(); return pixels;
      };
      overlay.hide();
      await loadBackdrop(fixture + '<style>html{background:lime}</style>');
      backdrop.show();
      const reference = await sample('reference');
      check(reference.empty[1] > 200 && reference.opaque[2] > 200, 'native reference composition is visible');
      await loadBackdrop('<style>html,body{margin:0;background:lime}</style><script>window.clicks=0;addEventListener("pointerdown",()=>window.clicks++);</script>');
      overlay.show(); overlay.moveTop();
      const compare = async name => {
        backdrop.setBounds(overlay.getBounds()); overlay.moveTop();
        const pixels = await sample(name);
        check(Object.keys(reference).every(key => pixels[key].every((value, i) => Math.abs(value - reference[key][i]) <= 3)),
          `${name}: transparent, opaque and half-alpha pixels match native composition`);
      };
      await compare('initial');
      const clicks = win => win.webContents.executeJavaScript('window.clicks');
      const click = () => { const b = overlay.getContentBounds(); xdo('mousemove', b.x + 50, b.y + 50, 'click', 1); };
      click(); await waitFor(async () => await clicks(overlay) === 1, 'normal pointer reaches overlay');
      check(await clicks(backdrop) === 0, 'normal pointer does not reach backdrop');
      xdo('key', '--clearmodifiers', 'ctrl+shift+alt+x');
      await waitFor(() => overlay.mouseEvent === true, 'native shortcut enables click-through');
      click(); await waitFor(async () => await clicks(backdrop) === 1, 'click-through reaches backdrop');
      check(await clicks(overlay) === 1, 'click-through suppresses overlay pointer delivery');
      xdo('key', '--clearmodifiers', 'ctrl+shift+alt+x');
      await waitFor(() => overlay.mouseEvent === false, 'native shortcut restores interaction');
      overlay.moveTop(); click();
      await waitFor(async () => await clicks(overlay) === 2, 'pointer delivery restored');
      check(await clicks(backdrop) === 1, 'restored interaction no longer reaches backdrop');
      overlay.setSize(700, 400);
      await compare('resized');
      backdrop.focus(); await waitFor(() => !overlay.isFocused(), 'overlay loses focus');
      await compare('unfocused');
      overlay.minimize(); await waitFor(() => overlay.isMinimized(), 'minimized');
      overlay.restore(); overlay.show(); await waitFor(() => !overlay.isMinimized(), 'restored');
      await compare('restored');
      overlay.reload(); await waitFor(() => !overlay.webContents.isLoading(), 'reload');
      await compare('reloaded');
      backdrop.destroy(); report.passed = true; save(); app.quit();
    } catch (error) { report.error = error.stack; save(); console.error(error); app.exit(1); }
  });
}
