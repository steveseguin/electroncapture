'use strict';

// Runs a copied Windows portable SFX with a disposable portable profile.
// Real process launches test startup fuses, persistence, named-window reuse and
// Node-mode separation. No protocol registration or installed profile is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
assert.equal(process.platform, 'win32');
assert.ok(process.env.VALIDATION_EXECUTABLE, 'Set VALIDATION_EXECUTABLE to a portable SFX');
const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-windows-package-'));
const portable = path.join(root, 'portable'); fs.mkdirSync(portable);
const executable = path.join(portable, path.basename(process.env.VALIDATION_EXECUTABLE));
fs.copyFileSync(process.env.VALIDATION_EXECUTABLE, executable);
const fixture = path.join(root, 'fixture.js'), css = path.join(root, 'fixture.css');
const marker = path.join(root, 'node-options-executed'), injection = path.join(root, 'injection.js');
fs.writeFileSync(injection, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected')`);
fs.writeFileSync(css, 'body { --fixture-css: loaded; }');
const children = new Set(), reports = new Map(), commands = new Map();
const result = { passed: false, checks: [], reports: [] };
let sequence = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = async (promise, label, ms = 30000) => {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), ms); })]); }
  finally { clearTimeout(timer); }
};
const receive = async key => {
  for (let i = 0; i < 600; i++) {
    const queue = reports.get(key);
    if (queue?.length) { const report = queue.shift(); if (report.error) throw new Error(report.error); return report; }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for packaged report ${key}`);
};
const server = require('node:http').createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/report/') && request.method === 'POST') {
    let body = '';
    request.on('data', data => { body += data; if (body.length > 100000) request.destroy(); });
    request.on('end', () => {
      try {
        const name = url.pathname.slice(8);
        const queue = reports.get(name) || [];
        queue.push({ ...JSON.parse(body), cookieHeader: request.headers.cookie || '' }); reports.set(name, queue);
        response.end('ok');
      } catch (error) { console.error(error); response.writeHead(400); response.end('Invalid fixture report'); }
    });
  } else if (url.pathname.startsWith('/command/')) {
    const role = url.pathname.slice(9);
    const queue = commands.get(role) || [];
    queue.push(response); commands.set(role, queue);
    response.on('close', () => { const index = queue.indexOf(response); if (index >= 0) queue.splice(index, 1); });
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html', 'Set-Cookie': 'fixtureCookie=retained; Max-Age=600; HttpOnly; SameSite=Lax' });
    response.end('<!doctype html><title>Packaged validation fixture</title><body>Disposable packaged validation</body>');
  }
});
async function rendererFixture() {
  if (window.fixtureLoopStarted) return;
  window.fixtureLoopStarted = true;
  const role = location.pathname.slice(1);
  const post = (key, value) => fetch(`/report/${key}`, { method: 'POST', body: JSON.stringify(value) });
  const snapshot = () => ({ role, requireType: typeof require, processType: typeof process,
    apiType: typeof electronApi, css: getComputedStyle(document.body).getPropertyValue('--fixture-css').trim(),
    token: sessionStorage.getItem('fixtureWindow'), stored: localStorage.getItem('fixturePersistent'),
    cookieVisible: document.cookie, userAgent: navigator.userAgent,
    preferences: electronApi.getCapturePreferences(), parentPid: typeof process === 'object' ? process.ppid : null });
  try {
    for (let i = 0; i < 100 && getComputedStyle(document.body).getPropertyValue('--fixture-css').trim() !== 'loaded'; i++)
      await new Promise(resolve => setTimeout(resolve, 50));
    const initial = snapshot();
    if (!initial.token) sessionStorage.setItem('fixtureWindow', crypto.randomUUID());
    localStorage.setItem('fixturePersistent', 'retained');
    await post(`${role}-ready`, { initial, current: snapshot() });
    while (true) {
      const command = await (await fetch(`/command/${role}`)).json();
      await post(command.id, snapshot());
      if (command.op === 'close') { window.close(); return; }
      if (command.op === 'reload') { location.reload(); return; }
    }
  } catch (error) { await post(`${role}-error`, { error: error.stack }); }
}
fs.writeFileSync(fixture, `(${rendererFixture.toString()})();`);
async function command(role, op) {
  const id = `command-${++sequence}`;
  for (let i = 0; i < 600; i++) {
    const queue = commands.get(role);
    if (queue?.length) { queue.shift().end(JSON.stringify({ id, op })); return receive(id); }
    await sleep(50);
  }
  throw new Error(`No command connection from ${role}`);
}
function launch(role, nodeMode = false, name = 'fixture', extra = []) {
  const env = { ...process.env, PORTABLE_EXECUTABLE_DIR: portable,
    ELECTRON_CAPTURE_PORTABLE_LEGACY_USER_DATA_DIR: path.join(root, 'unused-legacy'),
    ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: `--require=${injection}` };
  delete env.ELECTRON_CAPTURE_USER_DATA_DIR;
  const args = ['--minimized', '--nodpi', '--width=640', '--height=360', `--windowName=${name}`,
    `--url=http://127.0.0.1:${server.address().port}/${role}`, `--js=${fixture}`, `--css=${css}`, nodeMode ? '--node' : '--no-node', ...extra];
  const child = spawn(executable, args, { env, windowsHide: true });
  children.add(child);
  let output = '';
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  child.exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => { children.delete(child); fs.writeFileSync(path.join(root, `${role}.log`), output); resolve(code); });
  });
  return child;
}
function check(report, nodeMode) {
  assert.equal(report.current.requireType, nodeMode ? 'function' : 'undefined');
  assert.equal(report.current.processType, nodeMode ? 'object' : 'undefined');
  assert.equal(report.current.apiType, 'object');
  assert.equal(report.current.css, 'loaded');
  assert.ok(report.cookieHeader.includes('fixtureCookie=retained'));
  assert.ok(!report.current.cookieVisible.includes('fixtureCookie'), 'HttpOnly cookie stays hidden');
  assert.equal(fs.existsSync(marker), false, 'packaged runtime must reject NODE_OPTIONS injection');
  result.reports.push(report);
}
(async () => {
  console.log(`Windows packaged workflow artifacts: ${root}`);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const initial = launch('initial');
  const first = await receive('initial-ready'); check(first, false);
  assert.equal(first.initial.stored, null);
  await command('initial', 'reload');
  const reloaded = await receive('initial-ready'); check(reloaded, false);
  assert.equal(reloaded.current.token, first.current.token);
  assert.equal(reloaded.current.stored, 'retained');
  await command('initial', 'close'); assert.equal(await deadline(initial.exit, 'initial exit'), 0);
  result.checks.push('published SFX startup, disabled Node environment injection, isolated renderer, CSS/JS and reload');

  const owner = launch('owner', false, 'reuse');
  const ownerReport = await receive('owner-ready'); check(ownerReport, false);
  assert.equal(ownerReport.initial.stored, 'retained', 'portable storage survives process restart');
  const secondLaunch = launch('reused', false, 'reuse');
  const reused = await receive('reused-ready'); check(reused, false);
  assert.equal(reused.current.token, ownerReport.current.token, 'named-window reuse preserves the existing browsing context');
  assert.equal(await deadline(secondLaunch.exit, 'secondary launcher exit'), 0);
  result.checks.push('real second process reuses the named window; portable storage survives restart');

  const nodeLaunch = launch('node', true, 'reuse', ['--hide-cursor-capture', '--playout-delay=2']);
  const nodeReport = await receive('node-ready'); check(nodeReport, true);
  assert.notEqual(nodeReport.current.token, reused.current.token, 'Node opt-in creates a separate browsing context');
  assert.equal(nodeReport.current.preferences.hideCursorCapture, true);
  assert.equal(nodeReport.current.preferences.playoutDelay, 2);
  assert.equal(await deadline(nodeLaunch.exit, 'Node secondary launcher exit'), 0);
  const stillIsolated = await command('reused', 'snapshot');
  assert.equal(stillIsolated.requireType, 'undefined');
  assert.equal(stillIsolated.processType, 'undefined');
  assert.equal(stillIsolated.preferences.hideCursorCapture, false, 'new window preferences must not overwrite existing window');
  await command('node', 'close');
  await command('reused', 'close');
  assert.equal(await deadline(owner.exit, 'final app exit'), 0);
  result.checks.push('explicit Node opt-in stays in a separate window and leaves existing renderer isolation/preferences intact');
  assert.equal(fs.existsSync(marker), false);
  assert.ok(fs.existsSync(path.join(portable, 'ElectronCapture-data', 'profile')));
  result.passed = true;
})().catch(error => { result.error = error.stack; console.error(error); process.exitCode = 1; }).finally(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.pid) await new Promise(resolve => execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => resolve()));
  }
  server.closeAllConnections(); server.close();
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed, checks: result.checks, error: result.error }));
});
