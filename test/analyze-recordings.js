'use strict';

// node test/analyze-recordings.js <artifact directory> <ffmpeg executable> [--wait]
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const [root, ffmpeg] = process.argv.slice(2);
if (!root || !ffmpeg) throw new Error('Provide artifact directory and FFmpeg executable');

async function decode(file, completed) {
  const result = { file: path.basename(file), videoFrames: 0, audioFrames: 0, maxVideoGapSeconds: 0,
    maxAudioGapSeconds: 0, videoTimestampRegressions: 0, audioTimestampRegressions: 0, errors: [] };
  let previousAudioStart;
  // FFmpeg writes audio/video filter logs from separate threads; combined
  // stderr lines can interleave and silently lose frame counts/timestamps.
  // Decode each track separately so every parsed timestamp has one source.
  async function decodeTrack(track) {
    const filters = track === 'video'
      ? ['-map', '0:v:0', '-vf', 'showinfo', '-an', '-fps_mode', 'passthrough']
      : ['-map', '0:a:0', '-af', 'ashowinfo', '-vn'];
    const child = spawn(ffmpeg, ['-hide_banner', '-nostats', '-i', file, ...filters, '-f', 'null', '-'], { windowsHide: true });
    child.stdout.resume();
    const consume = line => {
      const time = /pts_time:([\d.e+-]+)/.exec(line);
      if (track === 'audio' && /Parsed_ashowinfo/.test(line) && time) {
        const current = Number(time[1]);
        if (result.audioEnd !== undefined) result.maxAudioGapSeconds = Math.max(result.maxAudioGapSeconds, current - result.audioEnd);
        if (previousAudioStart !== undefined && current < previousAudioStart) result.audioTimestampRegressions++;
        previousAudioStart = current;
        result.audioFrames++;
        result.audioStart ??= Number(time[1]);
        const samples = Number(/nb_samples:(\d+)/.exec(line)?.[1]);
        const rate = Number(/rate:(\d+)/.exec(line)?.[1]);
        result.audioEnd = Number(time[1]) + samples / rate;
      } else if (track === 'video' && /Parsed_showinfo/.test(line) && time) {
        result.videoFrames++;
        result.videoStart ??= Number(time[1]);
        if (result.videoEnd !== undefined) {
          result.maxVideoGapSeconds = Math.max(result.maxVideoGapSeconds, Number(time[1]) - result.videoEnd);
          if (Number(time[1]) < result.videoEnd) result.videoTimestampRegressions++;
        }
        result.videoEnd = Number(time[1]);
      }
      if (/Error|corrupt|invalid|non.monoton/i.test(line) && result.errors.length < 20) result.errors.push(line);
    };
    let pending = '';
    child.stderr.on('data', data => {
      pending += data;
      const lines = pending.split(/[\r\n]/); pending = lines.pop();
      lines.forEach(consume);
    });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    if (pending) consume(pending);
    return code;
  }
  result.trackExitCodes = await Promise.all(['video', 'audio'].map(decodeTrack));
  result.exitCode = result.trackExitCodes.every(code => code === 0) ? 0 : 1;
  result.endOffsetSeconds = result.audioEnd - result.videoEnd;
  result.startOffsetSeconds = result.audioStart - result.videoStart;
  result.offsetChangeSeconds = result.endOffsetSeconds - result.startOffsetSeconds;
  result.expectedSeconds = completed?.elapsedSeconds;
  result.videoSeconds = result.videoEnd - result.videoStart;
  result.audioSeconds = result.audioEnd - result.audioStart;
  result.averageVideoFps = result.videoFrames / result.videoSeconds;
  // A short/truncated clip can have perfectly matched A/V timestamps. Require
  // both decoded tracks to cover the actual fixture run, allowing one second
  // for recorder startup/shutdown and final HTTP chunk delivery.
  result.complete = Number.isFinite(result.expectedSeconds) && result.expectedSeconds > 0 &&
    result.videoSeconds >= result.expectedSeconds - 1 && result.audioSeconds >= result.expectedSeconds - 1;
  result.passed = result.exitCode === 0 && result.videoFrames > 0 && result.audioFrames > 0 &&
    result.complete && Number.isFinite(result.offsetChangeSeconds) && Math.abs(result.offsetChangeSeconds) < 0.25 && !result.errors.length &&
    result.videoTimestampRegressions === 0 && result.audioTimestampRegressions === 0;
  return result;
}

(async () => {
  const deadline = Date.now() + 75 * 60 * 1000;
  if (process.argv.includes('--wait')) {
    while (!fs.existsSync(path.join(root, 'result.json'))) {
      if (Date.now() > deadline) throw new Error('Recording run did not finish within 75 minutes');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  const run = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'));
  const report = { run, recordings: [] };
  for (const file of fs.readdirSync(root).filter(file => file.endsWith('.webm'))) {
    report.recordings.push(await decode(path.join(root, file), run.completed?.[path.basename(file, '.webm')]));
  }
  const metricsPath = path.join(root, 'metrics.jsonl');
  if (fs.existsSync(metricsPath)) {
    const samples = fs.readFileSync(metricsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    // privateBytes is Windows-only; use resident memory on other platforms.
    const metric = samples.every(sample => sample.processes.every(process => Number.isFinite(process.memory.privateBytes)))
      ? 'privateBytes' : 'workingSetSize';
    const totals = samples.map(sample => sample.processes.reduce((sum, process) => sum + process.memory[metric], 0) / 1024);
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const windowSize = Math.min(20, Math.max(1, Math.floor(totals.length / 2)));
    const earlyStart = totals.length >= 40 ? 10 : 0;
    report.memory = { metric, samples: samples.length, firstMB: totals[0], lastMB: totals.at(-1), peakMB: Math.max(...totals),
      earlyMeanMB: mean(totals.slice(earlyStart, earlyStart + windowSize)), lateMeanMB: mean(totals.slice(-windowSize)) };
    report.memory.lateMinusEarlyMB = report.memory.lateMeanMB - report.memory.earlyMeanMB;
  }
  const names = report.recordings.map(recording => path.basename(recording.file, '.webm')).sort();
  const completedNames = Object.keys(run.completed || {}).sort();
  report.passed = run.exitCode === 0 && names.includes('normal') &&
    JSON.stringify(names) === JSON.stringify(completedNames) && report.recordings.every(recording => recording.passed);
  fs.writeFileSync(path.join(root, 'analysis.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
