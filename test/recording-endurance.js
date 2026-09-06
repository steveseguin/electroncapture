'use strict';

// Opt-in real Electron test with generated media, not a hardware capture test.
// node test/recording-endurance.js [seconds]; defaults to one hour.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function recordingFixture(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360;
  document.body.append(canvas);
  const context = canvas.getContext('2d');
  let frames = 0;
  const timer = setInterval(() => {
    context.fillStyle = frames % 60 < 30 ? '#224466' : '#662244';
    context.fillRect(0, 0, 640, 360);
    context.fillStyle = 'white'; context.font = '30px sans-serif';
    context.fillText(`${name}: frame ${frames++}`, 20, 100);
  }, 1000 / 30);
  const audio = new AudioContext({ sampleRate: 48000 });
  await audio.resume();
  const oscillator = audio.createOscillator();
  oscillator.frequency.value = 440;
  const destination = audio.createMediaStreamDestination();
  oscillator.connect(destination); oscillator.start();
  const video = canvas.captureStream(30);
  const stream = new MediaStream([...video.getTracks(), ...destination.stream.getTracks()]);
  const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 250000 });
  let pending = Promise.resolve();
  let chunks = 0;
  const started = performance.now();
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  recorder.ondataavailable = event => {
    if (!event.data.size) return;
    chunks++;
    pending = pending.then(async () => {
      const response = await fetch(`/chunk/${name}`, { method: 'POST', body: event.data });
      if (!response.ok) throw new Error('Recording chunk write failed');
    });
  };
  recorder.onerror = event => rejectDone(new Error(event.error?.message || 'Recorder failed'));
  recorder.onstop = async () => {
    try {
      await pending;
      clearInterval(timer); oscillator.stop(); stream.getTracks().forEach(track => track.stop());
      await audio.close();
      const result = { name, chunks, frames, elapsedSeconds: (performance.now() - started) / 1000 };
      await fetch(`/done/${name}`, { method: 'POST', body: JSON.stringify(result) });
      resolveDone(result);
    } catch (error) { rejectDone(error); }
  };
  window.stopValidationRecording = () => {
    if (recorder.state !== 'inactive') recorder.stop();
    return done;
  };
  window.electronApi.exposeDoSomethingInWebApp(event => {
    if (event.data.close || event.data.hangup) window.stopValidationRecording();
  });
  recorder.start(1000);
  return { state: recorder.state, tracks: stream.getTracks().map(track => track.kind) };
}

if (!process.versions.electron) {
  (async () => {
    const seconds = Number(process.argv[2] || 3600);
    assert.ok(Number.isFinite(seconds) && seconds >= 5);
    const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-recording-validation-'));
    const completed = {};
    const server = require('node:http').createServer((request, response) => {
      const match = /^\/(chunk|done)\/(normal|close|quit)$/.exec(request.url);
      if (request.method === 'POST' && match) {
        const parts = [];
        request.on('data', part => parts.push(part));
        request.on('end', () => {
          try {
            const body = Buffer.concat(parts);
            if (match[1] === 'chunk') fs.appendFileSync(path.join(root, `${match[2]}.webm`), body);
            else completed[match[2]] = JSON.parse(body);
            response.end('ok');
          } catch (error) { response.statusCode = 500; response.end(String(error)); }
        });
      } else { response.setHeader('Content-Type', 'text/html'); response.end('<body>Local recording validation</body>'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const env = { ...process.env, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(root, 'profile'), VALIDATION_ROOT: root, VALIDATION_SECONDS: String(seconds) };
    delete env.ELECTRON_RUN_AS_NODE;
    const packaged = process.env.VALIDATION_EXECUTABLE;
    const fixture = path.join(root, 'packaged-fixture.js');
    if (packaged) fs.writeFileSync(fixture, `(${recordingFixture.toString()})('normal').then(() => setTimeout(async () => { await window.stopValidationRecording(); window.close(); }, ${seconds * 1000}));`);
    const args = ['--multiinstance', '--minimized', '--no-node', '--nodpi', `--url=${url}`];
    if (packaged) args.push(`--js=${fixture}`);
    else args.unshift(__filename);
    const child = require('node:child_process').spawn(packaged || require('electron'), args,
      { cwd: path.join(__dirname, '..'), env, windowsHide: true });
    const log = fs.createWriteStream(path.join(root, 'runtime.log'));
    child.stdout.pipe(log); child.stderr.pipe(log);
    console.log(`Validation artifacts: ${root}`);
    const timeout = setTimeout(() => child.kill(), (seconds + 120) * 1000);
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); });
    clearTimeout(timeout); server.close(); log.end();
    const result = { exitCode: code, requestedSeconds: seconds, completed };
    fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
    assert.equal(code, 0);
    assert.deepEqual(Object.keys(completed).sort(), packaged ? ['normal'] : ['close', 'normal', 'quit']);
    assert.ok(completed.normal.elapsedSeconds >= seconds - 1);
    console.log(JSON.stringify(result));
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, screen } = require('electron');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async predicate => {
    for (let i = 0; i < 240; i++) { if (await predicate()) return; await sleep(50); }
    throw new Error('Timed out waiting for recording condition');
  };
  require('../main');
  app.whenReady().then(async () => {
    try {
      await waitFor(() => BrowserWindow.getAllWindows().length === 1);
      const first = BrowserWindow.getAllWindows()[0];
      await waitFor(() => !first.webContents.isLoading());
      const devices = await first.webContents.executeJavaScript('navigator.mediaDevices.enumerateDevices().then(d => d.map(x => ({kind:x.kind,label:x.label})))');
      fs.writeFileSync(path.join(process.env.VALIDATION_ROOT, 'environment.json'), JSON.stringify({ versions: process.versions, displays: screen.getAllDisplays(), devices }, null, 2));
      const start = (window, name) => window.webContents.executeJavaScript(`(${recordingFixture.toString()})(${JSON.stringify(name)})`);
      assert.equal((await start(first, 'normal')).state, 'recording');
      const deadline = Date.now() + Number(process.env.VALIDATION_SECONDS) * 1000;
      let cycle = 0;
      while (Date.now() < deadline) {
        await sleep(Math.min(30000, deadline - Date.now()));
        const metrics = { secondsRemaining: Math.max(0, Math.round((deadline - Date.now()) / 1000)), processes: app.getAppMetrics() };
        fs.appendFileSync(path.join(process.env.VALIDATION_ROOT, 'metrics.jsonl'), JSON.stringify(metrics) + '\n');
        if (++cycle % 2 === 0) {
          app.emit('second-instance', {}, [], process.cwd(), { ...first.args, title: `Validation ${cycle}`, t: `Validation ${cycle}` });
          await waitFor(() => BrowserWindow.getAllWindows().length === 2);
          const other = BrowserWindow.getAllWindows().find(window => window !== first);
          other.close(); await waitFor(() => other.isDestroyed());
        }
      }
      await first.webContents.executeJavaScript('stopValidationRecording()');
      app.emit('second-instance', {}, [], process.cwd(), { ...first.args, title: 'Close recording', t: 'Close recording' });
      await waitFor(() => BrowserWindow.getAllWindows().length === 2);
      const second = BrowserWindow.getAllWindows().find(window => window !== first);
      await waitFor(() => !second.webContents.isLoading());
      await start(second, 'close'); await sleep(10000);
      second.close(); await waitFor(() => second.isDestroyed());
      assert.equal(first.isDestroyed(), false);
      await start(first, 'quit'); await sleep(10000);
      app.quit(); app.quit();
    } catch (error) { console.error(error); app.exit(1); }
  });
}
