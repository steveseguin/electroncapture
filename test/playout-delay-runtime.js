'use strict';

// Generated local video encodes a frame number as black/white bars. Decode that
// number to measure actual playout latency; a preference getter alone is not proof.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
async function measure(seconds, settleSeconds) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
  const context = canvas.getContext('2d'); let frame = 0; const times = new Map();
  const draw = setInterval(() => {
    frame++; times.set(frame, performance.now());
    for (let bit = 0; bit < 16; bit++) { context.fillStyle = frame & (1 << bit) ? '#fff' : '#000'; context.fillRect(bit * 40, 0, 40, 360); }
  }, 1000 / 30);
  const stream = canvas.captureStream(30), sender = new RTCPeerConnection({ iceServers: [] }), receiver = new RTCPeerConnection({ iceServers: [] });
  const video = document.createElement('video'); video.muted = true; document.body.append(video);
  receiver.ontrack = event => { video.srcObject = new MediaStream([event.track]); video.play().catch(() => {}); };
  const gather = pc => new Promise((resolve, reject) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const timer = setTimeout(() => reject(new Error('ICE timeout')), 10000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timer); resolve(); } });
  });
  try {
    const transceiver = sender.addTransceiver(stream.getVideoTracks()[0], { direction: 'sendonly' });
    transceiver.setCodecPreferences(RTCRtpSender.getCapabilities('video').codecs.filter(codec => codec.mimeType === 'video/VP8'));
    await sender.setLocalDescription(await sender.createOffer()); await gather(sender);
    await receiver.setRemoteDescription(sender.localDescription);
    await receiver.setLocalDescription(await receiver.createAnswer()); await gather(receiver);
    await sender.setRemoteDescription(receiver.localDescription);
    const incoming = receiver.getReceivers().find(item => item.track.kind === 'video');
    const report = { requestedSeconds: seconds, settleSeconds, hintSupported: 'playoutDelayHint' in incoming,
      hint: incoming.playoutDelayHint, hook: RTCPeerConnection.prototype.setRemoteDescription.name,
      state: globalThis[Symbol.for('electroncapture.capturePreferenceHooks')]?.preferences, samples: [], receiverStats: [] };
    const decoded = document.createElement('canvas'), ctx = decoded.getContext('2d', { willReadFrequently: true });
    const start = performance.now(), duration = (seconds + settleSeconds) * 1000;
    let nextStats = 0;
    while (performance.now() - start < duration) {
      await sleep(100);
      if (performance.now() - start >= nextStats) {
        const stats = [...(await receiver.getStats()).values()].find(item => item.type === 'inbound-rtp' && item.kind === 'video');
        if (stats) report.receiverStats.push({ elapsed: performance.now() - start, framesReceived: stats.framesReceived,
          framesDecoded: stats.framesDecoded, framesDropped: stats.framesDropped, fps: stats.framesPerSecond,
          jitterBufferDelay: stats.jitterBufferDelay, jitterBufferTargetDelay: stats.jitterBufferTargetDelay,
          jitterBufferEmittedCount: stats.jitterBufferEmittedCount, freezeCount: stats.freezeCount, totalFreezesDuration: stats.totalFreezesDuration });
        nextStats += 5000;
      }
      if (!video.videoWidth || video.readyState < 2) continue;
      decoded.width = video.videoWidth; decoded.height = video.videoHeight; ctx.drawImage(video, 0, 0);
      let number = 0;
      for (let bit = 0; bit < 16; bit++) if (ctx.getImageData(Math.floor((bit + 0.5) * decoded.width / 16), Math.floor(decoded.height / 2), 1, 1).data[0] > 128) number |= 1 << bit;
      if (times.has(number)) report.samples.push({ elapsed: performance.now() - start, latency: performance.now() - times.get(number) });
    }
    const finalSamples = report.samples.filter(sample => sample.elapsed > duration - 3000);
    const final = finalSamples.map(sample => sample.latency).sort((a,b) => a-b);
    report.medianLatencyMs = final[Math.floor(final.length / 2)];
    // A frozen old frame can momentarily have the requested age. Its source
    // timestamp must keep advancing throughout the final observation window.
    const sourceTime = sample => sample.elapsed - sample.latency;
    report.finalSourceProgressMs = finalSamples.length > 1 ? sourceTime(finalSamples.at(-1)) - sourceTime(finalSamples[0]) : 0;
    report.passed = final.length >= 10 && report.finalSourceProgressMs > 1000 && Math.abs(report.medianLatencyMs - seconds * 1000) < 1000;
    return report;
  } finally { clearInterval(draw); stream.getTracks().forEach(track => track.stop()); sender.close(); receiver.close(); video.remove(); }
}
if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-playout-runtime-'));
  fs.writeFileSync(path.join(directory, 'fixture.html'), '<!doctype html><body>Generated playout measurement</body>');
  console.log(`Playout delay artifacts: ${directory}`);
  const reports = [];
  const settleSeconds = Number(process.env.VALIDATION_PLAYOUT_SETTLE || 7);
  assert.ok(Number.isInteger(settleSeconds) && settleSeconds >= 7 && settleSeconds <= 120);
  const delays = process.env.VALIDATION_PLAYOUT_DELAYS?.split(',').map(Number) || [0, 2, 15];
  assert.ok(delays.length && delays.every(delay => Number.isFinite(delay) && delay >= 0 && delay <= 600));
  for (const delay of delays) {
    const env = { ...process.env, PLAYOUT_ARTIFACTS: directory, PLAYOUT_SECONDS: String(delay), ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, `profile-${delay}`) };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = require('node:child_process').spawnSync(process.env.VALIDATION_ELECTRON || require('electron'), [__filename,
      '--multiinstance', '--minimized', '--no-node', `--playoutDelay=${delay}`,
      `--url=${require('node:url').pathToFileURL(path.join(directory, 'fixture.html'))}`],
    { env, cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: (delay + settleSeconds + 38) * 1000 });
    fs.writeFileSync(path.join(directory, `runtime-${delay}.log`), (run.stdout || '') + (run.stderr || ''));
    const file = path.join(directory, `result-${delay}.json`);
    const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { passed: false, error: run.error?.message || 'Missing report' };
    reports.push(report); console.log(JSON.stringify({ ...report, samples: report.samples?.length, receiverStats: report.receiverStats?.at(-1) }));
  }
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(reports, null, 2));
  process.exitCode = reports.every(report => report.passed) ? 0 : 1;
} else {
  const { app, BrowserWindow } = require('electron');
  app.setAsDefaultProtocolClient = () => false; app.isDefaultProtocolClient = () => true;
  require('../main');
  app.whenReady().then(async () => {
    let report = { electron: process.versions.electron, passed: false };
    const delay = Number(process.env.PLAYOUT_SECONDS);
    try {
      let window;
      for (let i = 0; i < 200; i++) {
        window = BrowserWindow.getAllWindows()[0];
        if (window && !window.webContents.isLoading()) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(window && !window.webContents.isLoading());
      report = { ...report, ...await window.webContents.executeJavaScript(`(${measure.toString()})(${delay},${Number(process.env.VALIDATION_PLAYOUT_SETTLE || 7)})`) };
    } catch (error) { report.error = error.stack; }
    fs.writeFileSync(path.join(process.env.PLAYOUT_ARTIFACTS, `result-${delay}.json`), JSON.stringify(report, null, 2));
    app.exit(report.passed ? 0 : 1);
  });
}
