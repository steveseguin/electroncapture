'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  buildMarkerValue,
  parseChecksumManifest,
  resolvePlatformTarget,
  resolveWindowsVariant
} = require('../scripts/install-custom-electron');
const { getWindowsArtifactFiles } = require('../afterPack');
const windows11Build = require('../electron-builder.win11');
const packageMetadata = require('../package.json');
const windows10Build = packageMetadata.build;

assert.strictEqual(packageMetadata.engines.node, '>=22.12.0');
for (const installer of ['install-electron-asio.js', 'install-window-audio-capture.js']) {
  const installerSource = fs.readFileSync(path.resolve('scripts', installer), 'utf8');
  assert.match(installerSource, /const npmArgs = \['ci'\];/);
  assert.doesNotMatch(installerSource, /npm\.cmd install/);
}

assert.strictEqual(resolveWindowsVariant([], {}), 'win10');
assert.strictEqual(resolveWindowsVariant([], { CUSTOM_ELECTRON_WINDOWS_VARIANT: 'win11' }), 'win11');
assert.strictEqual(
  resolveWindowsVariant(['--windows-variant=win10'], { CUSTOM_ELECTRON_WINDOWS_VARIANT: 'win11' }),
  'win10'
);
assert.throws(() => resolveWindowsVariant([], { CUSTOM_ELECTRON_WINDOWS_VARIANT: 'future' }), /expected win10 or win11/);

const windows10 = resolvePlatformTarget('win32', [], {});
assert.strictEqual(windows10.version, '39.8.10-qp20');
assert.strictEqual(windows10.releaseTag, 'v39.8.10-qp20');
assert.strictEqual(windows10.artifacts.get('x64'), 'electron-v39.8.10-qp20-win32-x64.zip');
assert.strictEqual(
  windows10.checksums.get('electron-v39.8.10-qp20-win32-x64.zip'),
  'cd8e11cbb51b742de0a1db617f286d65efed0e2d248b1854544ccb5f13258fa7'
);
assert.strictEqual(windows10Build.electronDownload.customDir, 'v39.8.10-qp20');

const windows11 = resolvePlatformTarget('win32', ['--windows-variant=win11'], {});
assert.strictEqual(windows11.version, '43.3.0-qp20');
assert.strictEqual(windows11.releaseTag, 'v43.3.0-qp20');
assert.strictEqual(windows11.artifacts.get('x64'), 'electron-v43.3.0-qp20-win32-x64.zip');
assert.strictEqual(
  windows11.checksums.get('electron-v43.3.0-qp20-win32-x64.zip'),
  'dea789ff232f1d13c5bc40004453d69024072b3f52a379b95cead04a46d87a21'
);
assert.strictEqual(windows11Build.electronVersion, '43.3.0-qp20');
assert.strictEqual(windows11Build.electronDownload.customDir, 'v43.3.0-qp20');
assert.strictEqual(windows11Build.nsis.artifactName, 'elecap-${version}-win11.${ext}');
assert.strictEqual(windows11Build.portable.artifactName, 'elecap-win11.exe');

const linux = resolvePlatformTarget('linux', [], { CUSTOM_ELECTRON_WINDOWS_VARIANT: 'future' });
assert.strictEqual(linux.version, '43.3.0');

const outputDir = path.resolve('test-output');
const fallbackArtifacts = getWindowsArtifactFiles(outputDir, '2.23.3', false);
assert.strictEqual(path.basename(fallbackArtifacts[0].source), 'elecap.exe');
assert.strictEqual(path.basename(fallbackArtifacts[1].source), 'elecap-2.23.3.exe');
assert.strictEqual(path.basename(fallbackArtifacts[0].dest), 'elecap_win_v2.23.3_portable.zip');

const windows11Artifacts = getWindowsArtifactFiles(outputDir, '2.23.3', true);
assert.strictEqual(path.basename(windows11Artifacts[0].source), 'elecap-win11.exe');
assert.strictEqual(path.basename(windows11Artifacts[1].source), 'elecap-2.23.3-win11.exe');
assert.strictEqual(path.basename(windows11Artifacts[0].dest), 'elecap_win11_v2.23.3_portable.zip');
assert.notDeepStrictEqual(windows11Artifacts, fallbackArtifacts);

const mainSource = fs.readFileSync(path.resolve('main.js'), 'utf8');
assert.match(
  mainSource,
  /if \(Argv\.encoderMode === 'software'\) \{\s*app\.commandLine\.appendSwitch\('disable-accelerated-video-encode'\);/,
  '--encmode=software must disable Chromium accelerated video encoding at startup'
);

const currentMarker = buildMarkerValue(
  windows10,
  'win32',
  'x64',
  windows10.artifacts.get('x64')
);
assert.notStrictEqual(currentMarker, '39.8.10-qp20:win32:x64');
assert.ok(currentMarker.includes('v39.8.10-qp20'));
assert.ok(currentMarker.endsWith(windows10.checksums.get('electron-v39.8.10-qp20-win32-x64.zip')));

const checksumEntries = parseChecksumManifest([
  `${'a'.repeat(64)}  text-mode.zip`,
  `${'b'.repeat(64)} *binary-mode.zip`
].join('\n'));
assert.strictEqual(checksumEntries.get('text-mode.zip'), 'a'.repeat(64));
assert.strictEqual(checksumEntries.get('binary-mode.zip'), 'b'.repeat(64));

console.log('Windows runtime configuration regression checks passed');
