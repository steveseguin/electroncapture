'use strict';

// Native Linux package smoke test; requires X11, xprop, and a built executable.
// Ephemeral profiles use basic password storage because headless CI has no unlocked keyring.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const executable = process.env.VALIDATION_EXECUTABLE;
assert.ok(executable, 'Set VALIDATION_EXECUTABLE to the packaged elecap executable');
const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-linux-package-'));
const results = [];
const children = new Set();
const reports = new Map();
const server = require('node:http').createServer((request, response) => {
  const name = request.url.slice(1);
  fs.appendFileSync(path.join(root, 'requests.log'), `${request.method} ${request.url}\n`);
  if (request.method === 'POST' && reports.has(name)) {
    let body = '';
    request.on('data', data => { body += data; });
    request.on('end', () => reports.get(name)({ data: JSON.parse(body), response }));
  } else {
    response.setHeader('Content-Type', 'text/html');
    response.end(`<title>Elecap-validation-${name}</title><body>Linux packaged validation</body>`);
  }
});

async function check(name, identity, nodeMode = false) {
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  const title = `Elecap-validation-${name}`;
  const fixture = path.join(directory, 'fixture.js');
  const css = path.join(directory, 'fixture.css');
  const marker = path.join(directory, 'node-injection-ran');
  const injection = path.join(directory, 'unexpected-node.js');
  fs.writeFileSync(injection, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unsafe')`);
  fs.writeFileSync(css, 'body { --package-check: loaded; }');
  fs.writeFileSync(fixture, `fetch('/${name}', { method: 'POST', body: JSON.stringify({
    userAgent: navigator.userAgent, node: typeof require, api: typeof window.electronApi,
    css: getComputedStyle(document.body).getPropertyValue('--package-check').trim()
  }) }).then(() => window.close());`);
  const report = new Promise(resolve => reports.set(name, resolve));
  const env = { ...process.env, ELECTRON_CAPTURE_USER_DATA_DIR: path.join(root, 'shared-profile'),
    XDG_DATA_HOME: path.join(root, 'xdg-data'), XDG_CONFIG_HOME: path.join(root, 'xdg-config'),
    ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: `--require=${injection}` };
  const args = ['--password-store=basic', '--ozone-platform=x11', '--nodpi', `--title=${title}`, `--url=http://127.0.0.1:${server.address().port}/${name}`,
    `--js=${fixture}`, `--css=${css}`, nodeMode ? '--node' : '--no-node'];
  if (identity) args.push(`--${name === 'alias' ? 'app-id' : 'class'}=${identity}`);
  else args.push('--multiinstance');
  const child = spawn(executable, args, { env });
  children.add(child);
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  let timer;
  try {
    const result = await Promise.race([report, exit.then(code => { throw new Error(`Premature exit ${code}: ${output}`); }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timeout: ${output}`)), 30000); })]);
    clearTimeout(timer);
    try {
      assert.match(result.data.userAgent, /Electron\/43\.8\.7\b/);
      assert.equal(result.data.node, nodeMode ? 'function' : 'undefined');
      assert.equal(result.data.api, 'object');
      assert.equal(result.data.css, 'loaded');
      assert.equal(fs.existsSync(marker), false, 'NODE_OPTIONS injection must be rejected');
      const expectedClass = `"${identity || 'elecap'}"`;
      let wmClass;
      for (let attempt = 0; attempt < 20 && !wmClass; attempt++) {
        const tree = execFileSync('xwininfo', ['-root', '-tree'], { encoding: 'utf8', timeout: 5000 });
        for (const id of [...tree.matchAll(/^\s+(0x[0-9a-f]+) /gm)].map(match => match[1])) {
          const queried = spawnSync('xprop', ['-id', id, '_NET_WM_PID', 'WM_CLASS'], { encoding: 'utf8', timeout: 5000 });
          // Unrelated windows may close between the tree snapshot and query.
          if (queried.status !== 0) continue;
          const properties = queried.stdout;
          if (properties.includes(`= ${child.pid}\n`) && properties.toLowerCase().includes(expectedClass)) {
            wmClass = properties.trim(); break;
          }
        }
        if (!wmClass) await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(wmClass, `No native window with expected WM_CLASS ${expectedClass} for PID ${child.pid}`);
      results.push({ name, ...result.data, wmClass, passed: true });
    } finally { result.response.end('ok'); }
    const code = await Promise.race([exit, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Window close did not quit')), 15000);
    })]);
    assert.equal(code, 0, output);
    assert.ok(!/uncaughtException|Object has been destroyed|MaxListenersExceededWarning/.test(output), output);
  } finally {
    clearTimeout(timer);
    fs.writeFileSync(path.join(directory, 'runtime.log'), output);
    child.kill(); children.delete(child); reports.delete(name);
  }
}

(async () => {
  console.log(`Linux packaged smoke artifacts: ${root}`);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  await check('default', null);
  // Shared profile and no explicit --multiinstance: identities must stay separate.
  await Promise.all([check('class', 'elecap-check-one'), check('alias', 'elecap-check-two')]);
  await check('node', 'elecap-check-node', true);
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  for (const child of children) child.kill();
  server.closeAllConnections(); server.close();
});
