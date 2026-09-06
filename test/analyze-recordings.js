'use strict';

// node test/analyze-recordings.js <artifact directory> <ffmpeg executable> [--wait]
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const [root, ffmpeg] = process.argv.slice(2);
if (!root || !ffmpeg) throw new Error('Provide artifact directory and FFmpeg executable');

async function decode(file) {
  const result = { file: path.basename(file), videoFrames: 0, audioFrames: 0, errors: [] };
  const child = spawn(ffmpeg, ['-hide_banner', '-i', file, '-vf', 'showinfo', '-af', 'ashowinfo',
    '-fps_mode', 'passthrough', '-f', 'null', '-'], { windowsHide: true });
  child.stdout.resume();
  let pending = '';
  child.stderr.on('data', data => {
    pending += data;
    const lines = pending.split(/[\r\n]/); pending = lines.pop();
    for (const line of lines) {
      const time = /pts_time:([\d.e+-]+)/.exec(line);
      if (/Parsed_ashowinfo/.test(line) && time) {
        result.audioFrames++;
        result.audioStart ??= Number(time[1]);
        const samples = Number(/nb_samples:(\d+)/.exec(line)?.[1]);
        const rate = Number(/rate:(\d+)/.exec(line)?.[1]);
        result.audioEnd = Number(time[1]) + samples / rate;
      } else if (/Parsed_showinfo/.test(line) && time) {
        result.videoFrames++;
        result.videoStart ??= Number(time[1]);
        result.videoEnd = Number(time[1]);
      }
      if (/Error|corrupt|invalid|non.monoton/i.test(line) && result.errors.length < 20) result.errors.push(line);
    }
  });
  result.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  result.endOffsetSeconds = result.audioEnd - result.videoEnd;
  result.offsetChangeSeconds = result.endOffsetSeconds - (result.audioStart - result.videoStart);
  result.passed = result.exitCode === 0 && result.videoFrames > 0 && result.audioFrames > 0 &&
    Number.isFinite(result.offsetChangeSeconds) && Math.abs(result.offsetChangeSeconds) < 0.25 && !result.errors.length;
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
    report.recordings.push(await decode(path.join(root, file)));
  }
  const metricsPath = path.join(root, 'metrics.jsonl');
  if (fs.existsSync(metricsPath)) {
    const samples = fs.readFileSync(metricsPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const totals = samples.map(sample => sample.processes.reduce((sum, process) => sum + process.memory.privateBytes, 0) / 1024);
    const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    report.memory = { samples: samples.length, firstMB: totals[0], lastMB: totals.at(-1), peakMB: Math.max(...totals),
      earlyMeanMB: mean(totals.slice(10, 30)), lateMeanMB: mean(totals.slice(-20)) };
    report.memory.lateMinusEarlyMB = report.memory.lateMeanMB - report.memory.earlyMeanMB;
  }
  report.passed = run.exitCode === 0 && report.recordings.length > 0 && report.recordings.every(recording => recording.passed);
  fs.writeFileSync(path.join(root, 'analysis.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
