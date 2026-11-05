'use strict';

// Capture only an owned synthetic window, never the user's screen or audio.
// API: https://www.electronjs.org/docs/latest/api/desktop-capturer
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
if (!process.versions.electron) {
  assert.equal(process.platform, 'win32');
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-desktop-capture-'));
  fs.writeFileSync(path.join(directory, 'receiver.html'), '<!doctype html><body>Owned window capture validation</body>');
  const env = { ...process.env, CAPTURE_ARTIFACTS: directory, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = require('node:child_process').spawnSync(process.env.VALIDATION_ELECTRON || require('electron'), [__filename,
    '--multiinstance', '--minimized', '--no-node', '--hideCursorCapture',
    `--url=${require('node:url').pathToFileURL(path.join(directory, 'receiver.html'))}`,
    ...(process.env.VALIDATION_WGC ? [`--wgc=${process.env.VALIDATION_WGC}`] : [])],
  { env, cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 90000 });
  fs.writeFileSync(path.join(directory, 'runtime.log'), (run.stdout || '') + (run.stderr || ''));
  console.log(`Desktop capture artifacts: ${directory}`);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  console.log(JSON.stringify({ ...report, captures: report.captures.map(({ colors, ...capture }) => capture),
    cursor: report.cursor?.map(({ samples, ...capture }) => ({ ...capture, maximumNonGreenPixels: Math.max(...samples) })) }));
  assert.equal(run.status, 0, report.error || run.error?.message);
  assert.equal(report.passed, true);
} else {
  const { app, BrowserWindow, desktopCapturer } = require('electron');
  app.setAsDefaultProtocolClient = () => false; app.isDefaultProtocolClient = () => true;
  const report = { electron: process.versions.electron, wgc: process.env.VALIDATION_WGC || 'default', passed: false, captures: [] };
  require('../main');
  app.whenReady().then(async () => {
    try {
      let receiver;
      for (let i = 0; i < 200; i++) {
        receiver = BrowserWindow.getAllWindows()[0];
        if (receiver && !receiver.webContents.isLoading()) break;
        await sleep(50);
      }
      assert.ok(receiver && !receiver.webContents.isLoading());
      report.preferences = await receiver.webContents.executeJavaScript('electronApi.getCapturePreferences()');
      assert.equal(report.preferences.hideCursorCapture, true);
      report.hooks = await receiver.webContents.executeJavaScript(`({
        displayMedia: MediaDevices.prototype.getDisplayMedia.name,
        state: globalThis[Symbol.for('electroncapture.capturePreferenceHooks')]?.preferences
      })`);
      const source = new BrowserWindow({ width: 640, height: 360, x: 100, y: 100, frame: false,
        backgroundColor: '#00ff00', webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
      await source.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><style>html,body{margin:0;background:#00ff00}#motion{width:60px;height:60px;background:#ff0000;position:absolute;top:5px}</style><div id="motion"></div><script>let x=0;setInterval(()=>{document.querySelector("#motion").style.left=(x++%300)+"px"},33)</script>'));
      source.show();
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
      const selected = sources.find(item => item.id === source.getMediaSourceId());
      assert.ok(selected, 'Only the owned synthetic source may be selected');
      receiver.webContents.session.setDisplayMediaRequestHandler((_request, callback) => callback({ video: selected }));
      report.sourceId = selected.id;
      for (const [width, height] of [[640, 360], [800, 450], [480, 270]]) {
        source.setSize(width, height); await sleep(300);
        const captured = await receiver.webContents.executeJavaScript(`(async () => {
          const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
          const video = document.createElement('video'); video.muted = true; video.srcObject = stream; document.body.append(video);
          try {
            await video.play();
            let frames = 0, lastTime = -1; const colors = [];
            const canvas = document.createElement('canvas'), context = canvas.getContext('2d', { willReadFrequently: true });
            for (let i = 0; i < 40; i++) {
              await new Promise(resolve => setTimeout(resolve, 50));
              if (video.currentTime !== lastTime) frames++; lastTime = video.currentTime;
              canvas.width = video.videoWidth; canvas.height = video.videoHeight;
              if (canvas.width && canvas.height) {
                context.drawImage(video, 0, 0);
                colors.push([...context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data]);
              }
            }
            return { width: video.videoWidth, height: video.videoHeight, frames, colors,
              settings: stream.getVideoTracks()[0].getSettings(), constraints: stream.getVideoTracks()[0].getConstraints() };
          } finally { stream.getTracks().forEach(track => track.stop()); video.srcObject = null; video.remove(); }
        })()`, true);
        report.captures.push(captured);
        assert.ok(captured.frames >= 10, 'Captured frames must advance');
        assert.equal(captured.width, width); assert.equal(captured.height, height);
        assert.ok(captured.colors.slice(-10).every(([r, g, b]) => r < 25 && g > 230 && b < 25), 'Capture must contain the owned green fixture');
      }
      if (process.env.VALIDATION_CURSOR === '1') {
        // Positive control: visible cursor must be captured before suppression
        // can be judged. Move only over this owned window, restoring afterwards.
        source.setSize(640, 360); source.setAlwaysOnTop(true); source.focus();
        await source.webContents.executeJavaScript('document.body.style.cursor="crosshair";document.documentElement.style.cursor="crosshair";true;');
        const handle = source.getNativeWindowHandle();
        const windowHandle = handle.length >= 8 ? Number(handle.readBigUInt64LE()) : handle.readUInt32LE();
        const { screen } = require('electron');
        const bounds = source.getBounds();
        const point = screen.dipToScreenPoint({ x: bounds.x + 320, y: bounds.y + 180 });
        report.cursor = [];
        for (const cursor of ['always', 'never']) {
          const capture = receiver.webContents.executeJavaScript(`(async () => {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: ${JSON.stringify(cursor)}, frameRate: 30 }, audio: false });
            const video = document.createElement('video'); video.muted = true; video.srcObject = stream;
            try {
              await video.play(); const canvas = document.createElement('canvas'); canvas.width=64;canvas.height=64;
              const context = canvas.getContext('2d',{willReadFrequently:true}); const samples=[];
              for(let i=0;i<60;i++) {
                await new Promise(resolve=>setTimeout(resolve,50));
                if(!video.videoWidth)continue;
                context.drawImage(video,video.videoWidth/2-32,video.videoHeight/2-32,64,64,0,0,64,64);
                const pixels=context.getImageData(0,0,64,64).data;let nonGreen=0;
                for(let p=0;p<pixels.length;p+=4)if(pixels[p]>40||pixels[p+1]<200||pixels[p+2]>40)nonGreen++;
                samples.push(nonGreen);
              }
              return {requested:${JSON.stringify(cursor)},settings:stream.getVideoTracks()[0].getSettings(),samples};
            } finally {stream.getTracks().forEach(track=>track.stop());video.srcObject=null;}
          })()`, true);
          const input = new Promise((resolve, reject) => require('node:child_process').execFile('powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'fixtures/windows-native-input.ps1'),
              '-Action', 'hold', '-WindowHandle', String(windowHandle), '-OwnerProcess', String(process.pid),
              '-X', String(point.x), '-Y', String(point.y)],
            { windowsHide: true, timeout: 10000 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
          const [result] = await Promise.all([capture, input]); report.cursor.push(result);
        }
        report.cursorPositiveControl = Math.max(...report.cursor[0].samples) > 10;
        report.cursorSuppressed = report.cursorPositiveControl ? Math.max(...report.cursor[1].samples) <= 10 : null;
        report.cursorStatus = report.cursorPositiveControl ? (report.cursorSuppressed ? 'passed' : 'failed') : 'inconclusive: visible-cursor control absent';
      }
      source.close();
      report.passed = true;
    } catch (error) { report.error = error.stack; }
    fs.writeFileSync(path.join(process.env.CAPTURE_ARTIFACTS, 'result.json'), JSON.stringify(report, null, 2));
    app.exit(report.passed ? 0 : 1);
  });
}
