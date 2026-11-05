'use strict';

// Uses actual encoded media to check the analyzer's pass/fail decisions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const ffmpeg = process.argv[2] || process.env.FFMPEG || 'ffmpeg';
const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-analysis-test-'));
const recording = path.join(root, 'normal.webm');
const manifest = seconds => fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({
  exitCode: 0, requestedSeconds: seconds, completed: { normal: { elapsedSeconds: seconds } },
}));
const analyze = () => {
  const child = spawnSync(process.execPath, [path.join(__dirname, 'analyze-recordings.js'), root, ffmpeg],
    { encoding: 'utf8', timeout: 30000 });
  assert.ifError(child.error);
  return { status: child.status, report: JSON.parse(fs.readFileSync(path.join(root, 'analysis.json'))) };
};
try {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2', '-c:v', 'libvpx', '-c:a', 'libopus', recording],
  { timeout: 30000, stdio: 'pipe' });
  manifest(2);
  const good = analyze();
  assert.equal(good.status, 0);
  assert.equal(good.report.passed, true);
  assert.equal(good.report.recordings[0].videoFrames, 60, 'Count every known video frame');
  assert.ok(good.report.recordings[0].audioFrames > 0);
  assert.ok(good.report.recordings[0].maxVideoGapSeconds < 0.04);
  manifest(30);
  const shortened = analyze();
  assert.equal(shortened.status, 1);
  assert.equal(shortened.report.recordings[0].complete, false, 'Aligned short tracks must fail completeness');
  manifest(2);
  fs.writeFileSync(recording, 'corrupt WebM');
  assert.equal(analyze().status, 1);
  fs.unlinkSync(recording);
  assert.equal(analyze().status, 1, 'A missing completed recording must fail');
  console.log('Recording analysis passed: exact frame count, timing, truncated/corrupt/missing recording rejection.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
