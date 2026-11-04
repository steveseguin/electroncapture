'use strict';

// Opt-in macOS compositor check. Requires Screen Recording permission and Xcode
// command-line tools. Captures only this test's window, never the whole desktop.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const exec = require('node:util').promisify(execFile);

if (!process.versions.electron) {
  assert.equal(process.platform, 'darwin', 'Native alpha validation requires macOS');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-native-alpha-'));
  fs.writeFileSync(path.join(directory, 'page.html'), '<!doctype html><style>' +
    'html,body{margin:0;background:transparent}' +
    '#opaque{position:absolute;left:40px;top:40px;width:30px;height:30px;background:red}' +
    '#half{position:absolute;left:90px;top:40px;width:30px;height:30px;background:rgba(0,0,255,.5)}' +
    '</style><div id="opaque"></div><div id="half"></div>');
  fs.writeFileSync(path.join(directory, 'window.swift'), `import CoreGraphics
import Foundation
guard CGPreflightScreenCaptureAccess() else { fatalError("Screen Recording permission required") }
let pid = Int(CommandLine.arguments[1])!
let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
let matches = windows.filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid && ($0[kCGWindowName as String] as? String) == "Native alpha validation" }
guard matches.count == 1, let id = matches[0][kCGWindowNumber as String] as? Int else { fatalError("Expected exactly one test window") }
print(id)
`);
  const env = { ...process.env, ALPHA_ARTIFACTS: directory, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename,
    '--multiinstance', '--nodpi', '--width=640', '--height=360', '--title=Native alpha validation',
    `--url=${require('node:url').pathToFileURL(path.join(directory, 'page.html'))}`],
    { env, cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 45000 });
  fs.writeFileSync(path.join(directory, 'runtime.log'), result.stdout + result.stderr);
  console.log(`Native alpha artifacts: ${directory}`);
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  assert.equal(report.passed, true);
  console.log('macOS compositor alpha passed:', report.pixels);
} else {
  const { app, BrowserWindow, nativeImage } = require('electron');
  app.setAsDefaultProtocolClient = () => false;
  app.isDefaultProtocolClient = () => true;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const directory = process.env.ALPHA_ARTIFACTS;
  require('../main');
  app.whenReady().then(async () => {
    try {
      let window;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        window = BrowserWindow.getAllWindows()[0];
        if (window?.isVisible() && !window.webContents.isLoading()) break;
        await sleep(50);
      }
      assert.ok(window?.isVisible(), 'test window must be visible');
      await sleep(500);
      const { stdout } = await exec('/usr/bin/swift', [path.join(directory, 'window.swift'), String(process.pid)]);
      const windowId = Number(stdout.trim());
      assert.ok(Number.isInteger(windowId) && windowId > 0);
      const screenshot = path.join(directory, 'compositor.png');
      await exec('/usr/sbin/screencapture', ['-x', '-o', '-l', String(windowId), screenshot]);
      const image = nativeImage.createFromPath(screenshot);
      const bitmap = image.toBitmap();
      const size = image.getSize();
      const width = Math.round(Math.sqrt(bitmap.length / 4 * size.width / size.height));
      const ratio = width / await window.webContents.executeJavaScript('window.innerWidth');
      const pixel = (x, y) => [...bitmap.subarray((Math.round(y * ratio) * width + Math.round(x * ratio)) * 4,
        (Math.round(y * ratio) * width + Math.round(x * ratio)) * 4 + 4)];
      const pixels = { transparent: pixel(10, 100), opaque: pixel(50, 50), translucent: pixel(100, 50) };
      assert.equal(pixels.transparent[3], 0);
      assert.equal(pixels.opaque[3], 255);
      assert.ok(Math.abs(pixels.translucent[3] - 128) <= 1);
      fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ passed: true, windowId, pixels }, null, 2));
      app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
}
