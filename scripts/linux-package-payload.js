'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

// Type-2 AppImages append SquashFS after the ELF section table. Reading the
// header lets the host inspect ARM packages without executing their runtimes.
function appImageOffset(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const header = Buffer.alloc(64);
    assert.equal(fs.readSync(fd, header, 0, header.length, 0), header.length);
    assert.equal(header.toString('hex', 0, 4), '7f454c46', 'Invalid AppImage ELF');
    assert.equal(header[5], 1, 'Expected little-endian AppImage');
    assert.equal(header.toString('hex', 8, 11), '414902', 'Expected type-2 AppImage');
    assert.ok(header[4] === 1 || header[4] === 2, 'Unsupported ELF class');
    const offset = header[4] === 2
      ? Number(header.readBigUInt64LE(40)) + header.readUInt16LE(58) * header.readUInt16LE(60)
      : header.readUInt32LE(32) + header.readUInt16LE(46) * header.readUInt16LE(48);
    assert.ok(Number.isSafeInteger(offset) && offset >= 64 && offset < fs.fstatSync(fd).size - 4,
      'Invalid AppImage filesystem offset');
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, offset);
    assert.equal(magic.toString(), 'hsqs', 'Missing AppImage SquashFS');
    return offset;
  } finally { fs.closeSync(fd); }
}

function digest(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyPayload(file, unpacked, extension) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'elecap-payload-'));
  const run = (command, args) => execFileSync(command, args, { stdio: 'pipe', timeout: 180000 });
  try {
    let payload;
    if (extension === 'deb') {
      run('dpkg-deb', ['-x', file, temporary]);
      payload = path.join(temporary, 'opt', 'elecap');
    } else if (extension === 'rpm') {
      run('bsdtar', ['-xf', file, '-C', temporary]);
      payload = path.join(temporary, 'opt', 'elecap');
    } else if (extension === 'tar.gz') {
      run('tar', ['-xzf', file, '-C', temporary]);
      const roots = fs.readdirSync(temporary);
      assert.equal(roots.length, 1, 'Portable archive must contain one application directory');
      payload = path.join(temporary, roots[0]);
    } else if (extension === 'AppImage') {
      payload = path.join(temporary, 'squashfs');
      run('unsquashfs', ['-no-progress', '-o', String(appImageOffset(file)), '-d', payload, file]);
    } else { throw new Error(`Unsupported package format: ${extension}`); }
    // Packaging targets add different updater/desktop metadata. All runtime
    // files, including the ASAR, locale data and shared libraries, must match.
    const metadata = new Set(['resources/app-update.yml', 'resources/package-type', 'resources/apparmor-profile']);
    let checked = 0;
    function compare(directory, relative = '') {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = path.posix.join(relative, entry.name);
        const source = path.join(directory, entry.name);
        const target = path.join(payload, name);
        if (metadata.has(name)) continue;
        if (entry.isDirectory()) compare(source, name);
        else if (entry.isFile()) {
          assert.equal(digest(target), digest(source), `Stale or corrupt ${path.basename(file)} payload: ${name}`);
          if (fs.statSync(source).mode & 0o111) assert.ok(fs.statSync(target).mode & 0o111, `Not executable: ${name}`);
          checked++;
        } else if (entry.isSymbolicLink()) {
          assert.equal(fs.readlinkSync(target), fs.readlinkSync(source), `Changed payload symlink: ${name}`);
        }
      }
    }
    compare(unpacked);
    assert.ok(checked > 0, 'No runtime files verified');
    return checked;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

module.exports = { appImageOffset, verifyPayload };
