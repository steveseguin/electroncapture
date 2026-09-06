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
  console.log('Runtime ZIP validation checks passed');
  clearTimeout(watchdog);
})().catch(error => { console.error(error); process.exitCode = 1; });
