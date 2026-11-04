'use strict';

// Local peer-to-peer encoding/decoding using generated video and no ICE servers.
// QP averages are diagnostic: they cannot establish a per-frame QP ceiling.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function probe() {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const canvas = document.createElement('canvas');
  canvas.width = 640; canvas.height = 360; document.body.append(canvas);
  const context = canvas.getContext('2d');
  let frame = 0;
  const draw = setInterval(() => {
    context.fillStyle = '#224466'; context.fillRect(0, 0, 640, 360);
    context.fillStyle = '#ffa500'; context.fillRect((frame++ * 7) % 600, 30, 40, 250);
  }, 1000 / 30);
  const source = canvas.captureStream(30);
  const results = [];
  const capabilities = RTCRtpSender.getCapabilities('video').codecs;
  const gather = pc => new Promise((resolve, reject) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const timer = setTimeout(() => { pc.removeEventListener('icegatheringstatechange', change); reject(new Error('ICE gathering timed out')); }, 10000);
    function change() {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', change); resolve();
      }
    }
    pc.addEventListener('icegatheringstatechange', change);
  });
  try {
    for (const name of ['VP8', 'VP9', 'H264']) {
      const codecs = capabilities.filter(codec => codec.mimeType.toLowerCase() === `video/${name.toLowerCase()}`);
      if (!codecs.length) throw new Error(`${name} capability missing`);
      const local = new RTCPeerConnection({ iceServers: [] });
      const remote = new RTCPeerConnection({ iceServers: [] });
      const video = document.createElement('video'); video.muted = true; document.body.append(video);
      remote.ontrack = event => { video.srcObject = new MediaStream([event.track]); video.play().catch(() => {}); };
      try {
        const transceiver = local.addTransceiver(source.getVideoTracks()[0], { direction: 'sendonly' });
        transceiver.setCodecPreferences(codecs);
        await local.setLocalDescription(await local.createOffer()); await gather(local);
        await remote.setRemoteDescription(local.localDescription);
        await remote.setLocalDescription(await remote.createAnswer()); await gather(remote);
        await local.setRemoteDescription(remote.localDescription);
        const parameters = transceiver.sender.getParameters();
        parameters.encodings[0].maxBitrate = 2000000;
        await transceiver.sender.setParameters(parameters);
        await sleep(5000);
        const outbound = [...(await local.getStats()).values()].find(stat => stat.type === 'outbound-rtp' && stat.kind === 'video');
        const inbound = [...(await remote.getStats()).values()].find(stat => stat.type === 'inbound-rtp' && stat.kind === 'video');
        if (!(outbound?.framesEncoded >= 10 && inbound?.framesDecoded >= 10)) throw new Error(`${name}: no sustained video delivery`);
        // Default WebRTC adaptation may reduce dimensions. Resolution locking
        // and QP-cap enforcement require separate stressed-media tests.
        if (!(inbound.frameWidth > 0 && inbound.frameWidth <= 640 && inbound.frameHeight > 0 && inbound.frameHeight <= 360)) {
          throw new Error(`${name}: invalid received dimensions ${inbound.frameWidth}x${inbound.frameHeight}`);
        }
        results.push({ codec: name, framesEncoded: outbound.framesEncoded, framesDecoded: inbound.framesDecoded,
          width: inbound.frameWidth, height: inbound.frameHeight, encoder: outbound.encoderImplementation,
          averageQp: outbound.qpSum === undefined ? null : outbound.qpSum / outbound.framesEncoded,
          qualityLimitationReason: outbound.qualityLimitationReason });
      } finally { local.close(); remote.close(); video.srcObject = null; video.remove(); }
    }
    return results;
  } finally { clearInterval(draw); source.getTracks().forEach(track => track.stop()); canvas.remove(); }
}

if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-webrtc-smoke-'));
  const env = { ...process.env, WEBRTC_ARTIFACTS: directory,
    ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(process.env.VALIDATION_ELECTRON || require('electron'),
    [__filename, '--multiinstance', '--minimized', '--no-node', '--nodpi', '--url=data:text/html,<body>Local WebRTC fixture</body>'],
    { cwd: path.resolve(__dirname, '..'), env, encoding: 'utf8', timeout: 90000, windowsHide: true });
  fs.writeFileSync(path.join(directory, 'runtime.log'), result.stdout + result.stderr);
  console.log(`WebRTC artifacts: ${directory}`);
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'result.json')));
  assert.equal(report.passed, true);
  console.log(JSON.stringify(report));
} else {
  const { app, BrowserWindow } = require('electron');
  app.setAsDefaultProtocolClient = () => false;
  app.isDefaultProtocolClient = () => true;
  const report = { electron: process.versions.electron, passed: false };
  const save = () => fs.writeFileSync(path.join(process.env.WEBRTC_ARTIFACTS, 'result.json'), JSON.stringify(report, null, 2));
  require('../main');
  app.whenReady().then(async () => {
    try {
      let window;
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        window = BrowserWindow.getAllWindows()[0];
        if (window && !window.webContents.isLoading()) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(window && !window.webContents.isLoading());
      report.results = await window.webContents.executeJavaScript(`(${probe.toString()})()`);
      report.passed = true; save(); app.quit();
    } catch (error) { report.error = error.stack; save(); console.error(error); app.exit(1); }
  });
}
