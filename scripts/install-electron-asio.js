#!/usr/bin/env node

/**
 * Install/build script for electron-asio native module
 *
 * Environment variables:
 *   ELECTRON_ASIO_SKIP=1  - Skip building the module
 *
 * Usage:
 *   node scripts/install-electron-asio.js [--force]
 */

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');

const MODULE_RELATIVE_PATH = path.join('native-modules', 'electron-asio');
const BINARY_RELATIVE_PATH = path.join(MODULE_RELATIVE_PATH, 'build', 'Release', 'electron_asio.node');
const DLL_RELATIVE_PATH = path.join(MODULE_RELATIVE_PATH, 'build', 'Release', 'portaudio_x64.dll');

main().catch(error => {
  console.error('[electron-asio] Failed to prepare native module.');
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  if (process.env.ELECTRON_ASIO_SKIP === '1') {
    console.log('[electron-asio] ELECTRON_ASIO_SKIP=1, skipping native module install.');
    return;
  }

  if (process.platform !== 'win32') {
    console.log(`[electron-asio] Skipping native module build on ${process.platform} (Windows only).`);
    return;
  }

  const projectRoot = path.resolve(__dirname, '..');
  const moduleDir = path.join(projectRoot, MODULE_RELATIVE_PATH);

  if (!fs.existsSync(moduleDir)) {
    console.warn(`[electron-asio] ${MODULE_RELATIVE_PATH} not found; skipping build.`);
    return;
  }

  // Check for source files
  const srcDir = path.join(moduleDir, 'src');
  const bindingGyp = path.join(moduleDir, 'binding.gyp');

  if (!fs.existsSync(srcDir) || !fs.existsSync(bindingGyp)) {
    console.warn('[electron-asio] Source files not found; skipping build.');
    return;
  }

  const binaryPath = path.join(projectRoot, BINARY_RELATIVE_PATH);
  const dllPath = path.join(projectRoot, DLL_RELATIVE_PATH);
  const forceBuild = process.argv.includes('--force');
  const binaryExists = await fileExists(binaryPath);

  if (binaryExists && !forceBuild) {
    console.log(`[electron-asio] Native binary already present at ${path.relative(projectRoot, binaryPath)}.`);

    // Ensure DLL is copied
    await ensureDllCopied(moduleDir, dllPath);
    return;
  }

  console.log(`[electron-asio] Installing dependencies and building native module in ${MODULE_RELATIVE_PATH}...`);
  await runNpmInstall(moduleDir);

  if (!(await fileExists(binaryPath))) {
    throw new Error(`Native binary missing after build: ${path.relative(projectRoot, binaryPath)}`);
  }

  // Ensure DLL is in build output
  await ensureDllCopied(moduleDir, dllPath);

  console.log('[electron-asio] Native module ready.');
}

async function fileExists(targetPath) {
  try {
    await fsPromises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDllCopied(moduleDir, dllPath) {
  if (await fileExists(dllPath)) {
    return;
  }

  // Copy from deps
  const srcDll = path.join(moduleDir, 'deps', 'portaudio', 'lib', 'portaudio_x64.dll');
  if (await fileExists(srcDll)) {
    const destDir = path.dirname(dllPath);
    await fsPromises.mkdir(destDir, { recursive: true });
    await fsPromises.copyFile(srcDll, dllPath);
    console.log('[electron-asio] Copied portaudio_x64.dll to build output.');
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
