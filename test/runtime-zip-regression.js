'use strict';
const assert = require('node:assert/strict');
const { validateLinks, validateRuntimeZip } = require('../scripts/validate-runtime-zip');
const fs = require('node:fs');
const path = require('node:path');

assert.doesNotThrow(() => validateLinks(['Framework/Versions/Current', 'Framework/Binary'], new Map([
  ['Framework/Versions/Current', 'A'], ['Framework/Binary', 'Versions/Current/Binary'],
])));
for (const target of ['../../outside', '/outside', 'C:/outside', '..\\outside']) {
  assert.throws(() => validateLinks(['dir/link'], new Map([['dir/link', target]])), /ZIP/);
}
assert.throws(() => validateLinks(['link'], new Map([['link', 'link']])), /Cyclic/);
assert.throws(() => validateLinks(['a/file'], new Map([['a', 'b'], ['b', '../outside']])), /escapes/);
assert.throws(() => validateLinks(['./dir/link'], new Map([['./dir/link', '../../outside']])), /escapes/);
assert.throws(() => validateLinks(['dir//link'], new Map([['dir//link', '../../outside']])), /escapes/);

(async () => {
  const watchdog = setTimeout(() => { console.error('ZIP validation timed out'); process.exit(1); }, 10000);
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-zip-regression-'));
  for (const [name, target, valid] of [['valid', 'file', true], ['escape', '../../outside', false]]) {
    const file = path.join(root, `${name}.zip`);
    const archive = require('archiver')('zip');
    const output = fs.createWriteStream(file);
    const closed = new Promise((resolve, reject) => { output.on('close', resolve); output.on('error', reject); archive.on('error', reject); });
    archive.pipe(output); archive.append('test', { name: 'dir/file' });
    archive.symlink('dir/link', target); await archive.finalize(); await closed;
    if (valid) await validateRuntimeZip(file);
    else await assert.rejects(validateRuntimeZip(file), /escapes/);
  }
  const runtime = path.join(root, 'node_modules', 'electron');
  fs.mkdirSync(path.join(runtime, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(runtime, 'package.json'), '{"name":"electron","version":"1.0.0"}');
  const sentinel = path.join(runtime, 'dist', 'working-runtime');
  fs.writeFileSync(sentinel, 'preserve me');
  const filename = 'electron-v39.8.10-qp20-win32-x64.zip';
  fs.writeFileSync(path.join(root, filename), 'corrupt replacement');
  fs.writeFileSync(path.join(root, 'SHASUMS256.txt'), `${'0'.repeat(64)}  ${filename}\n`);
  const failedInstall = require('node:child_process').spawnSync(process.execPath,
    [path.join(__dirname, '../scripts/install-custom-electron.js')], {
      cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true,
      env: { ...process.env, CUSTOM_ELECTRON_SKIP: '', CUSTOM_ELECTRON_LOCAL_DIR: root,
        CUSTOM_ELECTRON_WINDOWS_VARIANT: 'win10', npm_config_platform: 'win32', npm_config_arch: 'x64' },
    });
  assert.equal(failedInstall.status, 1);
  assert.match(failedInstall.stderr, /Checksum mismatch/);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve me', 'failed verification retains installed runtime');
  console.log('Runtime ZIP validation checks passed');
  clearTimeout(watchdog);
})().catch(error => { console.error(error); process.exitCode = 1; });
