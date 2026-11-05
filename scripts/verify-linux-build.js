#!/usr/bin/env node
'use strict';

// Run after a Linux build. Cross-architecture checks do not execute the binaries.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');
const { getCurrentFuseWire, FuseV1Options, FuseState } = require('@electron/fuses');
const { verifyPayload } = require('./linux-package-payload');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const architectures = {
  x64: { machine: 62, bits: 2, deb: 'amd64', rpm: 'x86_64', directory: 'linux-unpacked' },
  arm64: { machine: 183, bits: 2, deb: 'arm64', rpm: 'aarch64', directory: 'linux-arm64-unpacked' },
  armv7l: { machine: 40, bits: 1, deb: 'armhf', rpm: 'armv7l', directory: 'linux-armv7l-unpacked' },
};

async function verify(arch = process.argv[2] || process.arch) {
  const expected = architectures[arch];
  assert.ok(expected, `Unsupported Linux architecture: ${arch}`);
  const dist = path.resolve(process.env.ELECTRON_CAPTURE_DIST_DIR || path.join(root, 'dist'));
  const unpacked = path.join(dist, expected.directory);
  const executable = path.join(unpacked, 'elecap');
  const archive = path.join(unpacked, 'resources', 'app.asar');
  let elfCount = 0;
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { inspect(file); continue; }
      if (!entry.isFile()) continue;
      assert.ok(!/\.(node|dll)$/i.test(entry.name), `Unexpected native addon or Windows library: ${file}`);
      const fd = fs.openSync(file, 'r');
      const header = Buffer.alloc(20);
      const bytes = fs.readSync(fd, header, 0, 20, 0);
      fs.closeSync(fd);
      if (bytes < 20 || header.toString('hex', 0, 4) !== '7f454c46') continue;
      assert.equal(header[4], expected.bits, `Wrong ELF class: ${file}`);
      assert.equal(header[5], 1, `Expected little-endian ELF: ${file}`);
      assert.equal(header.readUInt16LE(18), expected.machine, `Wrong ELF architecture: ${file}`);
      elfCount++;
    }
  }
  inspect(unpacked);
  assert.ok(elfCount > 3, 'Missing bundled runtime libraries');
  assert.ok(fs.statSync(executable).mode & 0o111, 'Launcher must be executable');
  const wire = await getCurrentFuseWire(executable);
  for (const name of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments']) {
    assert.equal(wire[FuseV1Options[name]], FuseState.DISABLE, `${name} must be disabled`);
  }
  assert.equal(wire[FuseV1Options.EnableCookieEncryption], FuseState.ENABLE);
  const entries = asar.listPackage(archive).map(name => name.replace(/^\//, ''));
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json'));
  assert.equal(packaged.version, pkg.version);
  for (const required of ['main.js', 'preload.js', 'linux-app-identity.js', 'portable-data-paths.js']) {
    assert.ok(entries.includes(required), `Missing runtime source: ${required}`);
  }
  let sources = 0;
  for (const name of entries) {
    assert.ok(!/^(?:\.git(?:\/|$)|\.github(?:\/|$)|\.env(?:\.|$)|certs(?:\/|$)|test(?:\/|$)|scripts(?:\/|$))/.test(name), `Build/private file packaged: ${name}`);
    assert.ok(!/\.(?:node|dll|pfx|p12|pem|key)$/i.test(name), `Unexpected native/private file: ${name}`);
    if (!name.includes('/') && name.endsWith('.js')) {
      assert.ok(asar.extractFile(archive, name).equals(fs.readFileSync(path.join(root, name))), `Stale packaged source: ${name}`);
      sources++;
    }
  }
  assert.ok(asar.extractFile(archive, 'node_modules/undici/index.js').equals(fs.readFileSync(require.resolve('undici'))), 'Stale Undici runtime');
  const prefix = `elecap-${pkg.version}`;
  for (const extension of ['AppImage', 'deb', 'rpm', 'tar.gz']) {
    const suffix = extension === 'deb' ? (arch === 'armv7l' ? arch : expected.deb) : extension === 'rpm' ? expected.rpm : extension === 'AppImage' && arch === 'x64' ? 'x86_64' : arch;
    const file = path.join(dist, `${prefix}-${suffix}.${extension}`);
    assert.ok(fs.statSync(file).size > 1000000, `Missing/truncated artifact: ${file}`);
    if (extension === 'deb') {
      assert.equal(execFileSync('dpkg-deb', ['-f', file, 'Architecture'], { encoding: 'utf8' }).trim(), expected.deb);
      assert.equal(execFileSync('dpkg-deb', ['-f', file, 'Version'], { encoding: 'utf8' }).trim(), pkg.version.replace('-', '~'));
      const depends = execFileSync('dpkg-deb', ['-f', file, 'Depends'], { encoding: 'utf8' });
      for (const library of ['libasound2', 'libasound2t64', 'libgbm1', 'libsecret-1-0']) {
        assert.ok(depends.includes(library), `Missing DEB runtime dependency: ${library}`);
      }
    }
    if (extension === 'rpm') {
      assert.equal(execFileSync('rpm', ['-qp', '--queryformat', '%{ARCH}', file], { encoding: 'utf8' }).trim(), expected.rpm);
      execFileSync('rpm', ['-K', '--nosignature', file]);
      const files = execFileSync('rpm', ['-qpl', file], { encoding: 'utf8' });
      assert.ok(!files.includes('/usr/lib/.build-id'), 'RPM must not claim shared Electron build-id links');
      const depends = execFileSync('rpm', ['-qp', '--requires', file], { encoding: 'utf8' });
      for (const library of ['alsa-lib', 'mesa-libgbm', 'libsecret']) {
        assert.ok(depends.includes(library), `Missing RPM runtime dependency: ${library}`);
      }
    }
    if (extension === 'tar.gz') execFileSync('tar', ['-tzf', file], { stdio: 'ignore' });
    const checked = verifyPayload(file, unpacked, extension);
    console.log(`Verified ${extension} payload: ${checked} runtime files match the unpacked application.`);
  }
  console.log(`Verified Linux ${arch}: ${elfCount} ELF binaries, ${sources} source files, production dependency, security fuses, AppImage/DEB/RPM/tar.gz.`);
}

if (require.main === module) verify().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { verify };
