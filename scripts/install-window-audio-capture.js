#!/usr/bin/env node

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const MODULE_RELATIVE_PATH = path.join('native-modules', 'window-audio-capture');
const BINARY_RELATIVE_PATH = path.join(MODULE_RELATIVE_PATH, 'build', 'Release', 'window_audio_capture.node');

main().catch(error => {
  console.error('[window-audio-capture] Failed to prepare native module.');
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  if (process.env.WINDOW_AUDIO_CAPTURE_SKIP === '1') {
    console.log('[window-audio-capture] WINDOW_AUDIO_CAPTURE_SKIP=1, skipping native module install.');
    return;
  }

  if (process.platform !== 'win32') {
    console.log(`[window-audio-capture] Skipping native module build on ${process.platform}.`);
    return;
  }

  const projectRoot = path.resolve(__dirname, '..');
  const moduleDir = path.join(projectRoot, MODULE_RELATIVE_PATH);

  if (!fs.existsSync(moduleDir)) {
    console.warn(`[window-audio-capture] ${MODULE_RELATIVE_PATH} not found; skipping build.`);
    return;
  }

  const binaryPath = path.join(projectRoot, BINARY_RELATIVE_PATH);
  const forceBuild = process.argv.includes('--force');
  const binaryExists = await fileExists(binaryPath);

  if (binaryExists && !forceBuild) {
    console.log(`[window-audio-capture] Native binary already present at ${path.relative(projectRoot, binaryPath)}.`);
    return;
  }

  console.log(`[window-audio-capture] Installing dependencies and building native module in ${MODULE_RELATIVE_PATH}...`);
  await runNpmInstall(moduleDir);

  if (!(await fileExists(binaryPath))) {
    throw new Error(`Native binary missing after build: ${path.relative(projectRoot, binaryPath)}`);
  }

  console.log('[window-audio-capture] Native module ready.');
}

async function fileExists(targetPath) {
  try {
    await fsPromises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function runNpmInstall(cwd) {
  const npmCliPath = process.env.npm_execpath;
  const npmArgs = ['install'];
  let command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  let args = npmArgs;

  if (npmCliPath && fs.existsSync(npmCliPath)) {
    command = process.execPath;
    args = [npmCliPath, ...npmArgs];
  }

  await new Promise((resolve, reject) => {
    const install = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      env: process.env
    });

    install.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`npm install exited with code ${code}`));
    });

    install.on('error', reject);
  });
}
