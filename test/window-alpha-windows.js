'use strict';

// Native Windows compositor check. Captures only a 120x120 fixture rectangle
// covered by our own backdrop window; never captures the whole desktop.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');

if (!process.versions.electron) {
  assert.equal(process.platform, 'win32', 'Requires an interactive Windows desktop');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-windows-alpha-'));
  fs.writeFileSync(path.join(directory, 'page.html'), '<!doctype html><style>' +
    'html,body{margin:0;background:transparent}' +
    '#opaque{position:absolute;left:40px;top:40px;width:30px;height:30px;background:red}' +
    '#half{position:absolute;left:90px;top:40px;width:30px;height:30px;background:rgba(0,0,255,.5)}' +
    '</style><div id="opaque"></div><div id="half"></div>');
  fs.writeFileSync(path.join(directory, 'sample.ps1'), `param([int]$x, [int]$y, [double]$scale, [string]$output)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class AlphaDpi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
}
'@
[AlphaDpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
Add-Type -AssemblyName System.Drawing
$size = [int][Math]::Ceiling(120 * $scale)
$bitmap = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($x, $y, 0, 0, $bitmap.Size)
  $bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
  $result = @{}
  foreach ($point in @(@('empty',10,100), @('opaque',50,50), @('half',100,50))) {
    $pixel = $bitmap.GetPixel([int]($point[1] * $scale), [int]($point[2] * $scale))
    $result[$point[0]] = @([int]$pixel.R, [int]$pixel.G, [int]$pixel.B)
  }
  ConvertTo-Json -InputObject $result -Compress
} finally { $graphics.Dispose(); $bitmap.Dispose() }
`);
  const env = { ...process.env, ALPHA_ARTIFACTS: directory,
    ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(process.env.VALIDATION_ELECTRON || require('electron'), [__filename,
    '--multiinstance', '--pin', '--nodpi', '--width=640', '--height=360', '--title=Windows alpha fixture',
    `--url=${pathToFileURL(path.join(directory, 'page.html')).href}`],
  { cwd: root, env, encoding: 'utf8', timeout: 90000 });
  fs.writeFileSync(path.join(directory, 'runtime.log'), result.stdout + result.stderr);
  console.log(`Windows alpha artifacts: ${directory}`);
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  assert.equal(report.passed, true);
  console.log(`Windows compositor passed (${report.checks.length} states); Electron ${report.electron}`);
} else {
  const { app, BrowserWindow, screen } = require('electron');
  app.setAsDefaultProtocolClient = () => false;
  app.isDefaultProtocolClient = () => true;
  const directory = process.env.ALPHA_ARTIFACTS;
  const report = { passed: false, electron: process.versions.electron, checks: [] };
  const save = () => fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async predicate => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) { if (await predicate()) return; await sleep(50); }
    throw new Error('Timed out waiting for alpha fixture');
  };
  require('../main');
  app.whenReady().then(async () => {
    try {
      let overlay;
      await waitFor(() => {
        overlay = BrowserWindow.getAllWindows()[0];
        report.startup = overlay && { visible: overlay.isVisible(), loading: overlay.webContents.isLoading(),
          minimized: overlay.isMinimized(), url: overlay.webContents.getURL() };
        return overlay?.isVisible() && !overlay.webContents.isLoading();
      });
      const area = screen.getPrimaryDisplay().workArea;
      overlay.setPosition(area.x + 100, area.y + 100);
      const backdrop = new BrowserWindow({ ...overlay.getBounds(), frame: false, show: false,
        backgroundColor: '#00ff00', webPreferences: { sandbox: true, contextIsolation: true } });
      await backdrop.loadURL('data:text/html,<style>html,body{margin:0;background:lime}</style>');
      backdrop.setAlwaysOnTop(true);
      backdrop.showInactive();
      const capture = async (name, window) => {
        await sleep(500);
        const bounds = window.getContentBounds();
        const point = screen.dipToScreenPoint({ x: bounds.x, y: bounds.y });
        const scale = screen.getDisplayMatching(bounds).scaleFactor;
        const pixels = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
          '-File', path.join(directory, 'sample.ps1'), '-x', String(point.x), '-y', String(point.y),
          '-scale', String(scale), '-output', path.join(directory, `${name}.png`)],
        { encoding: 'utf8', timeout: 15000, windowsHide: true }));
        return { pixels, bounds, scale };
      };
      // Compare native transparency with an equivalent composition in an opaque
      // reference window. Desktop color management can map RGB 255 to other
      // captured values; a literal RGB assertion would misdiagnose that as alpha loss.
      overlay.hide();
      report.references = {};
      for (const color of ['lime', 'white']) {
        const html = fs.readFileSync(path.join(directory, 'page.html'), 'utf8') +
          `<style>html{background:${color}}</style>`;
        await backdrop.loadURL(`data:text/html,${encodeURIComponent(html)}`);
        const reference = await capture(`reference-${color}`, backdrop);
        assert.ok(reference.pixels.opaque[0] > 100 && reference.pixels.empty[1] > 100,
          'reference fixture must be visible and unobstructed');
        report.references[color] = reference.pixels;
      }
      await backdrop.loadURL('data:text/html,<style>html,body{margin:0;background:lime}</style>');
      overlay.show(); overlay.moveTop();
      const sample = async (name, color) => {
        backdrop.setBounds(overlay.getBounds());
        overlay.moveTop();
        const actual = await capture(name, overlay);
        report.checks.push({ name, ...actual }); save();
        for (const point of ['empty', 'opaque', 'half']) {
          const expected = report.references[color][point];
          assert.ok(actual.pixels[point].every((value, i) => Math.abs(value - expected[i]) <= 3),
            `${name}: ${point} must match the opaque reference composition`);
        }
      };
      await sample('initial', 'lime');
      assert.equal(overlay.isResizable(), true, 'custom runtime must retain window resizing');
      overlay.setSize(700, 400);
      await sample('resized', 'lime');
      backdrop.focus();
      await waitFor(() => !overlay.isFocused());
      await sample('unfocused', 'lime');
      overlay.minimize(); await waitFor(() => overlay.isMinimized());
      overlay.restore(); overlay.show(); await waitFor(() => !overlay.isMinimized());
      await sample('restored', 'lime');
      await backdrop.webContents.executeJavaScript('document.documentElement.style.background="white";document.body.style.background="white"');
      await sample('white-backdrop', 'white');
      backdrop.destroy();
      report.passed = true; save(); app.quit();
    } catch (error) { report.error = error.stack; save(); console.error(error); app.exit(1); }
  });
}
