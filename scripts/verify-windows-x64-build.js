#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');
const {
  FuseState,
  FuseV1Options,
  getCurrentFuseWire,
} = require('@electron/fuses');

const PE_MACHINE_X64 = 0x8664;
const projectRoot = path.resolve(__dirname, '..');
const distDir = process.env.ELECTRON_CAPTURE_DIST_DIR
  ? path.resolve(process.env.ELECTRON_CAPTURE_DIST_DIR)
  : path.join(projectRoot, 'dist');

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

async function main() {
  assertCustomElectronConfiguration();

  const unpackedExecutables = findFiles(distDir, (filePath) => (
    path.basename(filePath).toLowerCase() === 'elecap.exe' &&
    path.dirname(filePath).toLowerCase().includes('unpacked')
  ));
  const unpackedExecutable = unpackedExecutables.find(
    (filePath) => readPeMachine(filePath) === PE_MACHINE_X64,
  );
  if (!unpackedExecutable) {
    throw new Error(
      unpackedExecutables.length === 0
        ? 'Could not find an unpacked Windows elecap.exe'
        : `Could not find an x64 unpacked Windows elecap.exe among:\n${unpackedExecutables.join('\n')}`,
    );
  }

  const unpackedDir = path.dirname(unpackedExecutable);
  assertPeMachine(unpackedExecutable, PE_MACHINE_X64, 'x64');
  verifyNativeModule(unpackedDir, 'window_audio_capture.node', process.env.WINDOW_AUDIO_CAPTURE_SKIP === '1');
  verifyNativeModule(unpackedDir, 'electron_asio.node', process.env.ELECTRON_ASIO_SKIP === '1');
  verifyNativeModule(unpackedDir, 'portaudio_x64.dll', process.env.ELECTRON_ASIO_SKIP === '1');
  verifyPackagedFiles(unpackedDir);
  await verifyFuses(unpackedExecutable);
  verifyArtifacts();

  console.log(`Verified custom Windows x64 Electron executable: ${path.relative(projectRoot, unpackedExecutable)}`);
  console.log('Verified x64 native modules, security fuses, package contents, and release artifacts.');
}

function assertCustomElectronConfiguration() {
  const build = require('../package.json').build;
  const expected = {
    electronVersion: '39.2.16-qp20',
    mirror: 'https://github.com/steveseguin/electron/releases/download/',
    customDir: 'v39.2.16-qp20',
  };
  if (build.electronVersion !== expected.electronVersion) {
    throw new Error(`Custom Windows Electron version changed: ${build.electronVersion}`);
  }
  if (!build.electronDownload || build.electronDownload.mirror !== expected.mirror) {
    throw new Error(`Custom Windows Electron mirror changed: ${build.electronDownload && build.electronDownload.mirror}`);
  }
  if (build.electronDownload.customDir !== expected.customDir) {
    throw new Error(`Custom Windows Electron directory changed: ${build.electronDownload.customDir}`);
  }
}

function verifyNativeModule(unpackedDir, fileName, mayBeMissing) {
  const matches = findFiles(unpackedDir, (filePath) => path.basename(filePath).toLowerCase() === fileName.toLowerCase());
  if (matches.length === 0 && !mayBeMissing) {
    throw new Error(`Windows x64 package is missing ${fileName}`);
  }
  for (const match of matches) {
    assertPeMachine(match, PE_MACHINE_X64, 'x64');
  }
}

function verifyPackagedFiles(unpackedDir) {
  const asarPath = path.join(unpackedDir, 'resources', 'app.asar');
  if (!fs.existsSync(asarPath)) throw new Error(`Packaged app.asar not found: ${asarPath}`);

  const archiveEntries = asar.listPackage(asarPath);
  const entries = archiveEntries.map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, ''));
  const forbidden = [
    '.agents', '.claude', '.env', '.secret', 'build-config.env', 'certs',
    'CLAUDE.md', 'CODE_SIGNING.md', 'code-signing-cert.pem', 'customSign.js',
    'afterPack.js', 'afterPackArm64.js', 'afterPackHook.js', 'afterSign.js',
    'docs', 'electron-builder.env', 'electron-builder.win-arm64.js',
    'installer.nsh', 'package-lock.json', 'scripts', 'setFuses.js', 'test',
    'tests', 'vdoninja',
  ];
  const leaked = entries.filter((entry) => forbidden.some((name) => entry === name || entry.startsWith(`${name}/`)));
  if (leaked.length > 0) {
    throw new Error(`Build-only or sensitive files leaked into app.asar:\n${leaked.join('\n')}`);
  }
  if (!entries.includes('portable-data-paths.js')) {
    throw new Error('portable-data-paths.js is missing from app.asar');
  }

  const undiciIndexEntry = archiveEntries.find(
    (entry) => entry.replace(/\\/g, '/').replace(/^\/+/, '') === 'node_modules/undici/index.js',
  );
  if (!undiciIndexEntry) throw new Error('Packaged undici runtime is missing from app.asar');
  const packagedUndici = asar.extractFile(asarPath, undiciIndexEntry.replace(/^[\\/]+/, ''));
  const installedUndici = fs.readFileSync(require.resolve('undici'));
  if (!packagedUndici.equals(installedUndici)) {
    throw new Error('Packaged undici runtime does not match the dependency installed from package-lock.json');
  }
}

async function verifyFuses(executablePath) {
  const wire = await getCurrentFuseWire(executablePath);
  const expected = new Map([
    [FuseV1Options.RunAsNode, FuseState.DISABLE],
    [FuseV1Options.EnableCookieEncryption, FuseState.ENABLE],
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseState.DISABLE],
    [FuseV1Options.EnableNodeCliInspectArguments, FuseState.DISABLE],
  ]);
  for (const [fuse, state] of expected) {
    if (wire[fuse] !== state) {
      throw new Error(`Unexpected Electron fuse state for fuse ${fuse}: ${wire[fuse]}`);
    }
  }
}

function verifyArtifacts() {
  const version = require('../package.json').version;
  const expectedArtifacts = [
    { filePath: path.join(distDir, `elecap-${version}.exe`), type: 'exe' },
    { filePath: path.join(distDir, 'elecap.exe'), type: 'exe' },
    { filePath: path.join(distDir, `elecap_win_v${version}_installer.zip`), type: 'zip' },
    { filePath: path.join(distDir, `elecap_win_v${version}_portable.zip`), type: 'zip' },
  ];
  for (const artifact of expectedArtifacts) {
    const stats = fs.statSync(artifact.filePath, { throwIfNoEntry: false });
    if (!stats || !stats.isFile() || stats.size === 0) {
      throw new Error(`Expected non-empty Windows x64 artifact not found: ${artifact.filePath}`);
    }
    if (artifact.type === 'zip') {
      const signature = fs.readFileSync(artifact.filePath).subarray(0, 4).toString('hex');
      if (!['504b0304', '504b0506', '504b0708'].includes(signature)) {
        throw new Error(`Artifact is not a valid ZIP file: ${artifact.filePath}`);
      }
    }
  }
}

function findFiles(root, predicate) {
  if (!fs.existsSync(root)) return [];
  const matches = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (entry.isFile() && predicate(fullPath)) matches.push(fullPath);
    }
  }
  return matches;
}

function assertPeMachine(filePath, expectedMachine, architectureName) {
  const machine = readPeMachine(filePath);
  if (machine !== expectedMachine) {
    throw new Error(`Expected ${architectureName} PE machine 0x${expectedMachine.toString(16)}, got 0x${machine.toString(16)}: ${filePath}`);
  }
}

function readPeMachine(filePath) {
  const data = fs.readFileSync(filePath);
  if (data.length < 0x40 || data.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error(`Not a valid PE file: ${filePath}`);
  }
  const peOffset = data.readUInt32LE(0x3c);
  if (peOffset + 6 > data.length || data.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`Missing PE header: ${filePath}`);
  }
  return data.readUInt16LE(peOffset + 4);
}
