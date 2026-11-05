'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const saved = { x: 100, y: 80, width: 640, height: 360 };
const scenarios = {
  defaults: [],
  explicitSize: ['--width=1280', '--height=720'],
  shortSize: ['-w1280', '-h720'],
  explicitWidth: ['--width=1280'],
  explicitHeight: ['--height=720'],
  explicitMonitor: ['--monitor=0'],
  deepLinkSize: [],
};
if (!process.versions.electron) {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-bounds-runtime-'));
  const results = [];
  for (const [name, flags] of Object.entries(scenarios)) {
    const profile = path.join(directory, name);
    fs.mkdirSync(profile);
    fs.writeFileSync(path.join(profile, 'window-bounds.json'), JSON.stringify(saved));
    const env = { ...process.env, ELECTRON_CAPTURE_USER_DATA_DIR: profile, BOUNDS_SCENARIO: name };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(process.env.VALIDATION_ELECTRON || require('electron'),
      [__filename, '--multiinstance', '--nodpi', '--password-store=basic', '--url=data:text/html,<body>Bounds fixture</body>', ...flags],
      { cwd: root, env, encoding: 'utf8', timeout: 30000 });
    const output = (result.stdout || '') + (result.stderr || '');
    fs.writeFileSync(path.join(profile, 'runtime.log'), output);
    const reportFile = path.join(profile, 'result.json');
    const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile)) : {};
    results.push({ name, ...report, passed: result.status === 0 && report.passed === true });
    console.log(name + ': ' + (results.at(-1).passed ? 'PASS' : 'FAIL'));
  }
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(results, null, 2));
  console.log('Bounds runtime artifacts: ' + directory);
  assert.ok(results.every(result => result.passed), 'Saved bounds overrode explicit geometry');
} else {
  const { app, BrowserWindow } = require('electron');
  const report = { passed: false, scenario: process.env.BOUNDS_SCENARIO };
  app.setAsDefaultProtocolClient = () => false;
  app.isDefaultProtocolClient = () => true;
  require(process.env.VALIDATION_PACKAGED_APP || '../main');
  app.whenReady().then(async () => {
    try {
      const end = Date.now() + 10000;
      let win;
      while (!(win = BrowserWindow.getAllWindows()[0]) || !win.isVisible()) {
        if (Date.now() > end) throw new Error('Timed out waiting for window');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (report.scenario === 'deepLinkSize') {
        const initial = win;
        app.emit('second-instance', {}, ['electroncapture://example.invalid/?w=1280&h=720'], root, {});
        while (!(win = BrowserWindow.getAllWindows().find(window => window !== initial)) || !win.isVisible()) {
          if (Date.now() > end) throw new Error('Timed out waiting for deep-link window');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      report.bounds = win.getBounds();
      if (report.scenario === 'defaults') assert.deepEqual(report.bounds, saved);
      else assert.deepEqual(win.getSize(), [1280, 720]);
      report.passed = true;
    } catch (error) { report.error = error.stack; }
    fs.writeFileSync(path.join(app.getPath('userData'), 'result.json'), JSON.stringify(report, null, 2));
    app.exit(report.passed ? 0 : 1);
  });
}
