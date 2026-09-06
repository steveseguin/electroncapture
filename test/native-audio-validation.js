'use strict';

// Windows-only opt-in integration test. Plays two quiet generated tones.
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
if (!process.versions.electron) {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-native-audio-'));
  const env = { ...process.env, VALIDATION_ROOT: root, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(root, 'profile') };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename, '--multiinstance', '--minimized', '--no-node', '--url=data:text/html,<body>Native audio validation</body>'],
    { env, cwd: path.join(__dirname, '..'), windowsHide: true, encoding: 'utf8', timeout: 90000 });
  fs.writeFileSync(path.join(root, 'runtime.log'), result.stdout + result.stderr);
  console.log(`Native audio validation artifacts: ${root}; exit=${result.status}`);
  process.exitCode = result.status ?? 1;
} else {
  const { app, BrowserWindow } = require('electron');
  const sourceArg = process.argv.find(arg => arg.startsWith('--source='));
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  if (sourceArg) {
    app.setPath('userData', path.join(process.env.VALIDATION_ROOT, sourceArg.slice(2)));
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
      await window.loadURL('data:text/html,<body>Generated audio source</body>');
      await window.webContents.executeJavaScript(`(async () => {
        window.context = new AudioContext(); await context.resume();
        const oscillator = context.createOscillator(); const gain = context.createGain();
        gain.gain.value = 0.01; oscillator.frequency.value = ${Number(sourceArg.split('=')[1])};
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start();
      })()`);
      console.log('SOURCE_READY');
    });
    setTimeout(() => app.exit(), 75000);
  } else {
    const children = [];
    const report = {};
    const waitFor = async predicate => {
      for (let i = 0; i < 240; i++) { if (await predicate()) return; await sleep(50); }
      throw new Error('Native audio validation timed out');
    };
    require('../main');
    app.whenReady().then(async () => {
      try {
        for (const frequency of [440, 660]) {
          const child = spawn(process.execPath, [__filename, `--source=${frequency}`], { env: process.env, windowsHide: true });
          children.push(child);
          let ready = false;
          child.stdout.on('data', data => { if (String(data).includes('SOURCE_READY')) ready = true; });
          child.stderr.on('data', () => {});
          await waitFor(() => ready);
        }
        await waitFor(() => BrowserWindow.getAllWindows().length === 1);
        const first = BrowserWindow.getAllWindows()[0];
        await waitFor(() => !first.webContents.isLoading());
        app.emit('second-instance', {}, [], process.cwd(), { ...first.args, title: 'Native owner B', t: 'Native owner B' });
        await waitFor(() => BrowserWindow.getAllWindows().length === 2);
        const second = BrowserWindow.getAllWindows().find(window => window !== first);
        await waitFor(() => !second.webContents.isLoading());
        const start = (window, target) => window.webContents.executeJavaScript(`(async () => {
          if (window.unsubscribe) window.unsubscribe();
          window.stats = { packets: 0, samples: 0, energy: 0, crossings: 0, last: 0 };
          window.unsubscribe = electronApi.onAudioStreamData(payload => {
            const data = payload.data || payload; const samples = data.samples || [];
            stats.packets++; stats.sampleRate = data.sampleRate; stats.channels = data.channels;
            for (let i = 0; i < samples.length; i += data.channels || 2) {
              const value = samples[i]; stats.samples++; stats.energy += value * value;
              if (stats.last <= 0 && value > 0) stats.crossings++; stats.last = value;
            }
          });
          return electronApi.startStreamCapture(${target});
        })()`);
        report.startA = await start(first, children[0].pid);
        assert.equal(report.startA.success, true);
        await sleep(3000);
        report.audioA = await first.webContents.executeJavaScript('JSON.parse(JSON.stringify(stats))');
        report.startB = await start(second, children[1].pid);
        assert.equal(report.startB.success, true);
        await sleep(3000);
        report.beforeOldStop = await second.webContents.executeJavaScript('stats.packets');
        await first.webContents.executeJavaScript(`electronApi.stopStreamCapture(${children[0].pid})`);
        await sleep(3000);
        report.audioB = await second.webContents.executeJavaScript('JSON.parse(JSON.stringify(stats))');
        assert.ok(report.audioB.packets > report.beforeOldStop, 'old owner stop must preserve new owner packets');
        for (const [key, expected] of [['audioA', 440], ['audioB', 660]]) {
          const audio = report[key];
          audio.rms = Math.sqrt(audio.energy / audio.samples);
          audio.estimatedFrequency = audio.crossings * audio.sampleRate / audio.samples;
          assert.ok(audio.rms > 0.0001, `${key} must contain a signal`);
          if (report[key === 'audioA' ? 'startA' : 'startB'].usingProcessSpecificLoopback) {
            assert.ok(Math.abs(audio.estimatedFrequency - expected) < 30, `${key} must isolate the expected tone`);
          }
        }
        await second.webContents.executeJavaScript(`electronApi.stopStreamCapture(${children[1].pid})`);
        report.restarts = [];
        for (let i = 0; i < 6; i++) {
          const owner = i % 2 ? second : first;
          const target = children[i % 2].pid;
          const result = await start(owner, target);
          assert.equal(result.success, true);
          await sleep(300);
          const packets = await owner.webContents.executeJavaScript('stats.packets');
          assert.ok(packets > 0, `restart ${i} must deliver audio`);
          report.restarts.push({ packets, processLoopback: result.usingProcessSpecificLoopback });
        }
        // The active source process exits unexpectedly; replacement must still work.
        children[1].kill();
        await sleep(500);
        report.afterSourceExit = await start(first, children[0].pid);
        assert.equal(report.afterSourceExit.success, true);
        await sleep(500);
        report.recoveryPackets = await first.webContents.executeJavaScript('stats.packets');
        assert.ok(report.recoveryPackets > 0, 'capture recovers after the previous source exits');
        report.passed = true;
      } catch (error) { report.error = String(error); }
      finally {
        children.forEach(child => child.kill());
        fs.writeFileSync(path.join(process.env.VALIDATION_ROOT, 'result.json'), JSON.stringify(report, null, 2));
        app.exit(report.passed ? 0 : 1);
      }
    });
  }
}
