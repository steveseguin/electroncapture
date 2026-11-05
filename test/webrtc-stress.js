'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const modes = {
  default: [], software: ['--encmode=software'],
  'lock-resolution': ['--lock-res'], 'lock-all': ['--no-scaling', '--playout-delay=2'],
  d3d12: ['--d3d12enc'],
};
async function stress(options) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const sources = [];
  const source = (width, height) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    document.body.append(canvas); const context = canvas.getContext('2d'); let frame = 0;
    const timer = setInterval(() => {
      context.fillStyle = '#16283a'; context.fillRect(0, 0, width, height);
      for (let i = 0; i < 180; i++) {
        context.fillStyle = `hsl(${(i * 37 + frame * 11) % 360} 80% 55%)`;
        context.fillRect((i * 73 + frame * 13) % width, (i * 37 + frame * 7) % height, 48, 48);
      }
      frame++;
    }, 1000 / 30);
    const stream = canvas.captureStream(30);
    const item = { canvas, stream, timer }; sources.push(item); return stream.getVideoTracks()[0];
  };
  const gather = pc => new Promise((resolve, reject) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const timer = setTimeout(() => { pc.removeEventListener('icegatheringstatechange', changed); reject(new Error('ICE gather timeout')); }, 10000);
    const changed = () => { if (pc.iceGatheringState === 'complete') { clearTimeout(timer); pc.removeEventListener('icegatheringstatechange', changed); resolve(); } };
    pc.addEventListener('icegatheringstatechange', changed);
  });
  const initial = source(1280, 720), replacement = source(640, 360);
  const results = [];
  try {
    for (const codecName of ['VP8', 'VP9', 'H264']) {
      const local = new RTCPeerConnection({ iceServers: [] }), remote = new RTCPeerConnection({ iceServers: [] });
      const video = document.createElement('video'); video.muted = true; document.body.append(video);
      const result = { codec: codecName, phases: [], contractFailures: [] };
      remote.ontrack = event => { video.srcObject = new MediaStream([event.track]); video.play().catch(() => {}); };
      try {
        const codecs = RTCRtpSender.getCapabilities('video').codecs.filter(codec => codec.mimeType.toLowerCase() === `video/${codecName.toLowerCase()}`);
        if (!codecs.length) throw new Error(`Missing ${codecName}`);
        const transceiver = local.addTransceiver(initial, { direction: 'sendonly' }); transceiver.setCodecPreferences(codecs);
        await local.setLocalDescription(await local.createOffer()); await gather(local);
        await remote.setRemoteDescription(local.localDescription);
        await remote.setLocalDescription(await remote.createAnswer()); await gather(remote);
        await local.setRemoteDescription(remote.localDescription);
        let previousEncoded = 0, previousDecoded = 0;
        for (const [name, bitrate, width, height] of [['high', 3000000, 1280, 720], ['constrained', 250000, 1280, 720], ['replacement', 3000000, 640, 360]]) {
          if (name === 'replacement') await transceiver.sender.replaceTrack(replacement);
          const parameters = transceiver.sender.getParameters(); parameters.encodings[0].maxBitrate = bitrate;
          await transceiver.sender.setParameters(parameters);
          const samples = [];
          for (let second = 0; second < 8; second++) {
            await sleep(1000);
            const sent = [...(await local.getStats()).values()].find(stat => stat.type === 'outbound-rtp' && stat.kind === 'video');
            const received = [...(await remote.getStats()).values()].find(stat => stat.type === 'inbound-rtp' && stat.kind === 'video');
            samples.push({ second: second + 1, encoded: sent?.framesEncoded || 0, decoded: received?.framesDecoded || 0,
              width: received?.frameWidth, height: received?.frameHeight, fps: sent?.framesPerSecond,
              qpSum: sent?.qpSum, limitation: sent?.qualityLimitationReason,
              encoder: sent?.encoderImplementation, powerEfficient: sent?.powerEfficientEncoder,
              playoutDelayHint: remote.getReceivers().find(receiver => receiver.track.kind === 'video')?.playoutDelayHint });
          }
          const last = samples.at(-1);
          if (last.encoded - previousEncoded < 10 || last.decoded - previousDecoded < 10) throw new Error(`${codecName}/${name}: media stalled`);
          if (!(last.width > 0 && last.width <= width && last.height > 0 && last.height <= height)) throw new Error(`${codecName}/${name}: invalid dimensions`);
          if (options.lockResolution && samples.slice(4).some(sample => sample.width !== width || sample.height !== height))
            result.contractFailures.push(`${name}: requested resolution lock delivered smaller frames`);
          result.phases.push({ name, requestedBitrate: bitrate, encoded: last.encoded - previousEncoded,
            decoded: last.decoded - previousDecoded, samples });
          previousEncoded = last.encoded; previousDecoded = last.decoded;
        }
        result.deliveryPassed = true;
      } catch (error) { result.error = error.stack; result.deliveryPassed = false; }
      finally { local.close(); remote.close(); video.srcObject = null; video.remove(); }
      result.passed = result.deliveryPassed && result.contractFailures.length === 0;
      results.push(result);
    }
    return results;
  } finally { for (const item of sources) { clearInterval(item.timer); item.stream.getTracks().forEach(track => track.stop()); item.canvas.remove(); } }
}
if (!process.versions.electron) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-webrtc-stress-'));
  console.log(`WebRTC stress artifacts: ${root}`);
  const results = [];
  for (const [mode, flags] of Object.entries(modes)) {
    const directory = path.join(root, mode); fs.mkdirSync(directory);
    const env = { ...process.env, WEBRTC_STRESS_DIR: directory, WEBRTC_STRESS_MODE: mode,
      ELECTRON_CAPTURE_USER_DATA_DIR: path.join(directory, 'profile') };
    delete env.ELECTRON_RUN_AS_NODE;
    const run = require('node:child_process').spawnSync(process.env.VALIDATION_ELECTRON || require('electron'), [__filename,
      '--multiinstance', '--minimized', '--no-node', '--url=data:text/html,<body>Generated codec stress</body>', ...flags],
    { env, cwd: path.resolve(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 150000 });
    fs.writeFileSync(path.join(directory, 'runtime.log'), (run.stdout || '') + (run.stderr || ''));
    const file = path.join(directory, 'result.json');
    const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : { error: run.error?.message || 'No report' };
    results.push({ mode, exitCode: run.status, ...report });
    console.log(JSON.stringify({ mode, passed: report.passed, results: report.results?.map(codec => ({ codec: codec.codec,
      delivery: codec.deliveryPassed, failures: codec.contractFailures, error: codec.error,
      sizes: codec.phases.map(phase => [phase.name, phase.samples.at(-1).width, phase.samples.at(-1).height]) })) }));
  }
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(results, null, 2));
  process.exitCode = results.every(result => result.passed && result.exitCode === 0) ? 0 : 1;
} else {
  const { app, BrowserWindow } = require('electron');
  app.setAsDefaultProtocolClient = () => false; app.isDefaultProtocolClient = () => true;
  const mode = process.env.WEBRTC_STRESS_MODE;
  const report = { electron: process.versions.electron, mode, passed: false };
  require('../main');
  app.whenReady().then(async () => {
    try {
      let window;
      for (let i = 0; i < 200; i++) {
        window = BrowserWindow.getAllWindows()[0];
        if (window && !window.webContents.isLoading()) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.ok(window && !window.webContents.isLoading());
      report.gpuStatus = app.getGPUFeatureStatus();
      report.gpuInfo = await app.getGPUInfo('complete');
      report.switches = { fieldTrials: app.commandLine.getSwitchValue('force-fieldtrials'),
        software: app.commandLine.hasSwitch('disable-accelerated-video-encode'), features: app.commandLine.getSwitchValue('enable-features') };
      report.results = await window.webContents.executeJavaScript(`(${stress.toString()})(${JSON.stringify({ lockResolution: mode.startsWith('lock-') })})`);
      report.passed = report.results.every(result => result.passed);
    } catch (error) { report.error = error.stack; console.error(error); }
    fs.writeFileSync(path.join(process.env.WEBRTC_STRESS_DIR, 'result.json'), JSON.stringify(report, null, 2));
    app.exit(report.passed ? 0 : 1);
  });
}
