'use strict';

// Opt-in: briefly opens available capture devices, without retaining their media.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function deviceChecks() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  const results = [];
  for (const device of devices) {
    if (device.deviceId === 'communications') continue;
    const result = { kind: device.kind, label: device.label };
    try {
      if (device.kind === 'audiooutput') {
        const element = document.createElement('audio');
        await element.setSinkId(device.deviceId);
        result.passed = element.sinkId === device.deviceId;
        await element.setSinkId('');
      } else {
        let expired = false;
        let timer;
        const request = navigator.mediaDevices.getUserMedia({
          [device.kind === 'audioinput' ? 'audio' : 'video']: { deviceId: { exact: device.deviceId } },
        }).then(stream => {
          if (expired) stream.getTracks().forEach(track => track.stop());
          return stream;
        });
        let stream;
        try {
          stream = await Promise.race([request, new Promise((_, reject) => {
            timer = setTimeout(() => { expired = true; reject(new Error('Device startup timed out')); }, 8000);
          })]);
          await new Promise(resolve => setTimeout(resolve, 1000));
          result.settings = stream.getTracks().map(track => ({ state: track.readyState, settings: track.getSettings() }));
          result.passed = stream.getTracks().every(track => track.readyState === 'live');
        } finally { clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()); }
      }
    } catch (error) { result.passed = false; result.error = `${error.name}: ${error.message}`; }
    results.push(result);
  }
  return results;
}

if (!process.versions.electron) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-device-validation-'));
  const page = path.join(root, 'page.html');
  fs.writeFileSync(page, '<body>Local device validation</body>');
  const env = { ...process.env, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(root, 'profile'), VALIDATION_ROOT: root };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename,
    '--multiinstance', '--minimized', '--no-node', '--nodpi', `--url=${require('node:url').pathToFileURL(page)}`,
  ], { env, cwd: path.join(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 120000 });
  fs.writeFileSync(path.join(root, 'runtime.log'), result.stdout + result.stderr);
  console.log(`Device validation artifacts: ${root}; exit=${result.status}`);
  const reportPath = path.join(root, 'result.json');
  const passed = fs.existsSync(reportPath) && JSON.parse(fs.readFileSync(reportPath, 'utf8')).passed;
  process.exitCode = result.status === 0 && passed ? 0 : 1;
} else {
  const { app, BrowserWindow, screen } = require('electron');
  const { resizeWindow } = require('../window-resolution');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async predicate => {
    for (let i = 0; i < 200; i++) { if (await predicate()) return; await sleep(50); }
    throw new Error('Runtime device test timed out');
  };
  require('../main');
  app.whenReady().then(async () => {
    const report = { displays: screen.getAllDisplays(), devices: [], downloads: [], resize: false };
    try {
      await waitFor(() => BrowserWindow.getAllWindows().length === 1);
      const first = BrowserWindow.getAllWindows()[0];
      await waitFor(() => !first.webContents.isLoading());
      report.devices = await first.webContents.executeJavaScript(`(${deviceChecks.toString()})()`);
      const scale = window => screen.getDisplayMatching(window.getBounds()).scaleFactor;
      first.show(); first.restore();
      await waitFor(() => first.isVisible() && !first.isMinimized());
      await sleep(500);
      resizeWindow(first, 1280, 720, scale);
      await waitFor(() => first.getSize()[0] === Math.round(1280 / scale(first)));
      first.setFullScreen(true);
      await sleep(1000);
      report.fullscreenState = { fullscreen: first.isFullScreen(), bounds: first.getBounds(), visible: first.isVisible(), minimized: first.isMinimized() };
      if (!first.isFullScreen()) {
        report.fullscreenWarning = 'Full-screen bounds applied but isFullScreen() returned false';
        first.setFullScreen(false);
        await sleep(500);
      }
      resizeWindow(first, 640, 360, scale);
      await waitFor(() => !first.isFullScreen() && first.getSize()[0] === Math.round(640 / scale(first)));
      assert.deepEqual(first.getSize(), [Math.round(640 / scale(first)), Math.round(360 / scale(first))]);
      report.resize = true;
      first.minimize();
      app.emit('second-instance', {}, [], process.cwd(), { ...first.args, title: 'Second download', t: 'Second download' });
      await waitFor(() => BrowserWindow.getAllWindows().length === 2);
      const second = BrowserWindow.getAllWindows().find(window => window !== first);
      await waitFor(() => !second.webContents.isLoading());
      for (const [index, window] of [first, second].entries()) {
        const folder = path.join(process.env.VALIDATION_ROOT, `downloads-${index}`);
        fs.mkdirSync(folder);
        window.args.savefolder = folder;
        const file = path.join(folder, 'validation.bin');
        const bytes = `window-${index}`;
        const done = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Download timeout')), 10000);
          window.webContents.session.once('will-download', (_event, item) => {
            item.once('done', (_event, state) => { clearTimeout(timer); resolve({ state, path: item.getSavePath() }); });
          });
        });
        await window.webContents.executeJavaScript(`(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([${JSON.stringify(bytes)}])); a.download = 'validation.bin'; a.click(); })()`);
        const download = await done;
        assert.equal(download.state, 'completed'); assert.equal(download.path, file);
        assert.equal(fs.readFileSync(file, 'utf8'), bytes);
        report.downloads.push(download);
      }
      report.passed = report.devices.every(device => device.passed) && !report.fullscreenWarning;
      fs.writeFileSync(path.join(process.env.VALIDATION_ROOT, 'result.json'), JSON.stringify(report, null, 2));
      app.quit();
    } catch (error) {
      report.error = String(error);
      fs.writeFileSync(path.join(process.env.VALIDATION_ROOT, 'result.json'), JSON.stringify(report, null, 2));
      console.error(error); app.exit(1);
    }
  });
}
