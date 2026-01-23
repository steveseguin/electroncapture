#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const CHECKSUM_MANIFEST = 'SHASUMS256.txt';
const PLATFORM_TARGETS = new Map([
  ['win32', {
    version: '39.2.8-qp20',
    releaseTag: 'v39.2.8-qp20',
    mirrorBase: 'https://github.com/steveseguin/electron/releases/download/',
    artifacts: new Map([
      ['x64', 'electron-v39.2.8-win32-x64.zip']
    ])
  }],
  ['linux', {
    version: '39.2.7',
    releaseTag: 'v39.2.7',
    mirrorBase: 'https://github.com/electron/electron/releases/download/',
    artifacts: new Map([
      ['x64', 'electron-v39.2.7-linux-x64.zip'],
      ['arm64', 'electron-v39.2.7-linux-arm64.zip']
    ])
  }],
  ['darwin', {
    version: '39.2.7',
    releaseTag: 'v39.2.7',
    mirrorBase: 'https://github.com/electron/electron/releases/download/',
    artifacts: new Map([
      ['x64', 'electron-v39.2.7-darwin-x64.zip'],
      ['arm64', 'electron-v39.2.7-darwin-arm64.zip']
    ])
  }]
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

  const platform = process.env.npm_config_platform || process.platform;
  const arch = process.env.npm_config_arch || process.arch;
  const target = PLATFORM_TARGETS.get(platform);

  if (!target) {
    console.log(`[custom-electron] No custom build configured for ${platform}/${arch}; skipping.`);
    return;
  }

  const customVersion = target.version;
  const filename = target.artifacts.get(arch);
  if (!filename) {
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
  const markerValue = `${customVersion}:${platform}:${arch}`;

  if (await isCustomVersionPresent(markerPath, markerValue)) {
    console.log(`[custom-electron] ${customVersion} already installed for ${platform}/${arch}; skipping download.`);
    return;
  }

  await fs.promises.rm(distDir, { recursive: true, force: true });
  await fs.promises.mkdir(distDir, { recursive: true });

  const localArtifact = resolveLocalArtifact(filename);
  let cleanup = async () => {};
  let zipPath;
  let expectedChecksum;

  if (localArtifact) {
    zipPath = localArtifact.zipPath;
    console.log(`[custom-electron] Using local artifact ${zipPath}`);
    if (localArtifact.manifestPath) {
      const checksums = await loadChecksumFile(localArtifact.manifestPath);
      expectedChecksum = checksums.get(filename);
    }
    if (!expectedChecksum) {
      console.log('[custom-electron] No checksum entry found locally; will verify via computed hash only.');
    }
  } else {
    const downloadUrl = `${target.mirrorBase}${target.releaseTag}/${filename}`;
    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'electron-custom-'));
    cleanup = async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    };
    zipPath = path.join(tmpDir, filename);
    try {
      const checksums = await loadChecksums(target);
      expectedChecksum = checksums.get(filename);

      if (!expectedChecksum) {
        throw new Error(`No checksum entry found for ${filename} in ${CHECKSUM_MANIFEST}`);
      }

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
    } catch (err) {
      await cleanup();
      throw err;
    }
  }

  try {
    const actualChecksum = await sha256File(zipPath);
    if (expectedChecksum && actualChecksum !== expectedChecksum) {
      throw new Error(`Checksum mismatch for ${filename}: expected ${expectedChecksum} but got ${actualChecksum}`);
    }

    const extractZip = require(require.resolve('extract-zip', { paths: [electronDir] }));
    await extractZip(zipPath, { dir: distDir });
  } finally {
    await cleanup();
  }

  await relocateTypeDefinitions(distDir, electronDir);

  await fs.promises.writeFile(path.join(distDir, 'version'), `${customVersion}`);
  await fs.promises.writeFile(markerPath, `${markerValue}\n`);
  await fs.promises.writeFile(path.join(electronDir, 'path.txt'), getPlatformPath(platform));

  console.log(`[custom-electron] Installed ${target.version} for ${platform}/${arch}.`);
}

async function isCustomVersionPresent (markerPath, expectedValue) {
  try {
    const data = await fs.promises.readFile(markerPath, 'utf8');
    return data.trim() === expectedValue;
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

const checksumCache = new Map();

async function loadChecksums (target) {
  const cacheKey = `${target.mirrorBase}|${target.releaseTag}`;
  if (checksumCache.has(cacheKey)) {
    return checksumCache.get(cacheKey);
  }

  const manifestUrl = `${target.mirrorBase}${target.releaseTag}/${CHECKSUM_MANIFEST}`;
  console.log(`[custom-electron] Fetching checksum manifest ${manifestUrl}`);
  const response = await fetch(manifestUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'electroncapture-custom-installer' }
  });

  if (!response.ok) {
    throw new Error(`Failed to download checksum manifest: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  const entries = parseChecksumManifest(text);
  checksumCache.set(cacheKey, entries);
  return entries;
}

function parseChecksumManifest (text) {
  const entries = new Map();
  const lines = text.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^([a-fA-F0-9]{64}) \*(.+)$/);
    if (match) {
      const [, hash, file] = match;
      entries.set(file, hash.toLowerCase());
    }
  }

  if (entries.size === 0) {
    throw new Error('Checksum manifest parsed but no entries were found.');
  }

  return entries;
}

async function sha256File (filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
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

function resolveLocalArtifact (filename) {
  for (const dir of getLocalDirCandidates()) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) {
      const manifestPath = path.join(dir, CHECKSUM_MANIFEST);
      return {
        zipPath: candidate,
        manifestPath: fs.existsSync(manifestPath) ? manifestPath : null
      };
    }
  }
  return null;
}

function getLocalDirCandidates () {
  const dirs = new Set();
  if (process.env.CUSTOM_ELECTRON_LOCAL_DIR) {
    dirs.add(process.env.CUSTOM_ELECTRON_LOCAL_DIR);
  }
  dirs.add(path.join(os.homedir(), 'electron-work-v36', 'src', 'out', 'Release-win'));
  return Array.from(dirs);
}

async function loadChecksumFile (manifestPath) {
  const contents = await fs.promises.readFile(manifestPath, 'utf8');
  return parseChecksumManifest(contents);
}
