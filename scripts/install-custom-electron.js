#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const CUSTOM_RELEASE_TAG = 'v40.0.0-qp20';
const CUSTOM_VERSION = '40.0.0-qp20';
const MIRROR_BASE = 'https://github.com/steveseguin/electron/releases/download/';
const ARTIFACTS = new Map([
  ['win32', new Map([
    ['x64', 'electron-v40.0.0-qp20-win32-x64.zip']
  ])],
  ['linux', new Map([
    ['x64', 'electron-v40.0.0-qp20-linux-x64.zip']
  ])]
]);

main().catch(err => {
  console.error('[custom-electron] Failed to install custom Electron build.');
  console.error(err);
  process.exitCode = 1;
});

async function main () {
  if (process.env.CUSTOM_ELECTRON_SKIP === '1') {
    console.log('[custom-electron] CUSTOM_ELECTRON_SKIP=1, skipping.');
    return;
  }

  const platform = process.platform;
  const arch = process.arch;

  if (!ARTIFACTS.has(platform) || !ARTIFACTS.get(platform).has(arch)) {
    console.log(`[custom-electron] No custom build configured for ${platform}/${arch}; skipping.`);
    return;
  }

  const electronPkgPath = resolveFromCwd('electron/package.json');
  if (!electronPkgPath) {
    console.warn('[custom-electron] electron package is not installed; skipping.');
    return;
  }

  const electronDir = path.dirname(electronPkgPath);
  const distDir = path.join(electronDir, 'dist');
  const markerPath = path.join(distDir, '.custom-version');

  if (await isCustomVersionPresent(markerPath)) {
    console.log(`[custom-electron] ${CUSTOM_VERSION} already installed; skipping download.`);
    return;
  }

  await fs.promises.rm(distDir, { recursive: true, force: true });
  await fs.promises.mkdir(distDir, { recursive: true });

  const filename = ARTIFACTS.get(platform).get(arch);
  const downloadUrl = `${MIRROR_BASE}${CUSTOM_RELEASE_TAG}/${filename}`;
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'electron-custom-'));
  const zipPath = path.join(tmpDir, filename);

  console.log(`[custom-electron] Downloading ${downloadUrl}`);
  const response = await fetch(downloadUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'electroncapture-custom-installer' }
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const nodeStream = Readable.fromWeb(response.body);
  await pipeline(nodeStream, fs.createWriteStream(zipPath));

  const extractZip = require(require.resolve('extract-zip', { paths: [electronDir] }));
  await extractZip(zipPath, { dir: distDir });

  await relocateTypeDefinitions(distDir, electronDir);

  await fs.promises.writeFile(path.join(distDir, 'version'), `${CUSTOM_VERSION}`);
  await fs.promises.writeFile(markerPath, CUSTOM_VERSION);
  await fs.promises.writeFile(path.join(electronDir, 'path.txt'), getPlatformPath(platform));

  console.log(`[custom-electron] Installed ${CUSTOM_VERSION} for ${platform}/${arch}.`);
}

async function isCustomVersionPresent (markerPath) {
  try {
    const data = await fs.promises.readFile(markerPath, 'utf8');
    return data.trim() === CUSTOM_VERSION;
  } catch {
    return false;
  }
}

async function relocateTypeDefinitions (distDir, electronDir) {
  const src = path.join(distDir, 'electron.d.ts');
  if (!fs.existsSync(src)) {
    return;
  }

  const dest = path.join(electronDir, 'electron.d.ts');

  if (fs.existsSync(dest)) {
    await fs.promises.rm(dest, { force: true });
  }

  await fs.promises.rename(src, dest);
}

function resolveFromCwd (id) {
  try {
    return require.resolve(id, { paths: [process.cwd()] });
  } catch {
    return null;
  }
}

function getPlatformPath (platform) {
  switch (platform) {
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return 'electron';
    case 'win32':
      return 'electron.exe';
    default:
      throw new Error(`Unsupported platform ${platform}`);
  }
}
