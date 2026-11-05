'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { appImageOffset, verifyPayload } = require('../scripts/linux-package-payload');
const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'elecap-payload-test-'));
try {
  const expected = path.join(root, 'expected');
  const staged = path.join(root, 'staged');
  fs.mkdirSync(path.join(expected, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(expected, 'elecap'), 'runtime', { mode: 0o755 });
  fs.writeFileSync(path.join(expected, 'resources', 'app.asar'), 'current application');
  fs.mkdirSync(staged);
  const payload = path.join(staged, 'elecap');
  fs.cpSync(expected, payload, { recursive: true });
  const archive = path.join(root, 'fixture.tar.gz');
  const pack = () => execFileSync('tar', ['-czf', archive, '-C', staged, 'elecap']);
  pack();
  assert.equal(verifyPayload(archive, expected, 'tar.gz'), 2);
  fs.writeFileSync(path.join(payload, 'resources', 'app.asar'), 'stale application');
  pack();
  assert.throws(() => verifyPayload(archive, expected, 'tar.gz'), /Stale or corrupt.*app.asar/);
  fs.copyFileSync(path.join(expected, 'resources', 'app.asar'), path.join(payload, 'resources', 'app.asar'));
  fs.chmodSync(path.join(payload, 'elecap'), 0o644);
  pack();
  assert.throws(() => verifyPayload(archive, expected, 'tar.gz'), /Not executable/);
  fs.chmodSync(path.join(payload, 'elecap'), 0o755);
  fs.writeFileSync(path.join(payload, 'elecap'), 'wrong runtime');
  pack();
  assert.throws(() => verifyPayload(archive, expected, 'tar.gz'), /Stale or corrupt.*elecap/);
  fs.truncateSync(archive, 64);
  assert.throws(() => verifyPayload(archive, expected, 'tar.gz'));
  for (const bits of [1, 2]) {
    const image = path.join(root, `fixture-${bits}.AppImage`);
    const bytes = Buffer.alloc(512);
    bytes.write('7f454c46', 0, 'hex'); bytes[4] = bits; bytes[5] = 1;
    bytes.write('414902', 8, 'hex');
    if (bits === 2) {
      bytes.writeBigUInt64LE(64n, 40); bytes.writeUInt16LE(64, 58); bytes.writeUInt16LE(2, 60);
    } else {
      bytes.writeUInt32LE(112, 32); bytes.writeUInt16LE(40, 46); bytes.writeUInt16LE(2, 48);
    }
    bytes.write('hsqs', 192); fs.writeFileSync(image, bytes);
    assert.equal(appImageOffset(image), 192);
    bytes[192] = 0; fs.writeFileSync(image, bytes);
    assert.throws(() => appImageOffset(image), /Missing AppImage SquashFS/);
    fs.truncateSync(image, 64);
    assert.throws(() => appImageOffset(image), /Invalid AppImage filesystem offset/);
  }
  console.log('Linux payload checks reject stale application/runtime, lost executable mode, truncated archives and invalid AppImage offsets.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
