'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const ENV_FILES = ['build-config.env', 'electron-builder.env'];
const DEFAULT_CERTIFICATE_FILE = 'certs/electroncapture.pfx';

function loadLocalEnvFiles() {
  for (const envFile of ENV_FILES) {
    const envPath = path.join(__dirname, envFile);
    if (!fs.existsSync(envPath)) continue;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
      if (!match) continue;

      const name = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (!process.env[name]) process.env[name] = value;
    }
  }
}

function resolveCertificateFile(certificateFile) {
  if (!certificateFile || typeof certificateFile !== 'string') return null;
  if (path.isAbsolute(certificateFile) && fs.existsSync(certificateFile)) return certificateFile;

  const projectRelativePath = path.resolve(__dirname, certificateFile);
  if (fs.existsSync(projectRelativePath)) return projectRelativePath;

  const cwdRelativePath = path.resolve(process.cwd(), certificateFile);
  if (fs.existsSync(cwdRelativePath)) return cwdRelativePath;

  return null;
}

function getPassword(configuration) {
  return configuration?.cscInfo?.password || process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD || '';
}

function sanitizeOutput(value, password) {
  let sanitized = String(value || '');
  if (password) sanitized = sanitized.split(password).join('***');
  return sanitized.trim();
}

async function runSignTool(toolPath, args, toolEnv, password) {
  const timeout = Number.parseInt(process.env.SIGNTOOL_TIMEOUT, 10) || DEFAULT_TIMEOUT_MS;

  try {
    await execFileAsync(toolPath, args, {
      cwd: __dirname,
      env: { ...process.env, ...(toolEnv || {}) },
      timeout,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    const stdout = sanitizeOutput(error.stdout, password);
    const stderr = sanitizeOutput(error.stderr, password);
    const message = sanitizeOutput(error.message, password);
    const details = [...new Set([stdout, stderr, message].filter(Boolean))].join('\n');
    throw new Error(`signtool failed for ${path.basename(args[args.length - 1])}${details ? `\n${details}` : ''}`);
  }
}

async function getSignTool(signingManager, isWindows) {
  const toolInfo = await signingManager.getToolPath(isWindows);
  if (!isWindows || fs.existsSync(toolInfo.path) || process.arch !== 'arm64') return toolInfo;

  const architectureDirectory = path.dirname(toolInfo.path);
  if (path.basename(architectureDirectory).toLowerCase() !== 'arm64') return toolInfo;

  const x64ToolPath = path.join(path.dirname(architectureDirectory), 'x64', path.basename(toolInfo.path));
  if (!fs.existsSync(x64ToolPath)) return toolInfo;

  console.log(`  * using x64 signtool under Windows ARM emulation  path=${x64ToolPath}`);
  return { ...toolInfo, path: x64ToolPath };
}

exports.default = async function signWindowsArtifact(configuration, packager) {
  loadLocalEnvFiles();

  const certificateFile = resolveCertificateFile(configuration?.cscInfo?.file || DEFAULT_CERTIFICATE_FILE);
  if (!certificateFile) {
    console.log(`  * skipping signing  reason=certificate not found at ${DEFAULT_CERTIFICATE_FILE}`);
    return false;
  }

  const password = getPassword(configuration);
  if (!password) {
    console.log('  * skipping signing  reason=WIN_CSC_KEY_PASSWORD not set');
    return false;
  }

  if (!configuration?.path) {
    throw new Error('Invalid signing configuration from electron-builder');
  }

  const cscInfo = {
    ...(configuration.cscInfo || {}),
    file: certificateFile,
    password,
  };

  const isWindows = process.platform === 'win32';
  if (!packager?.signingManager) throw new Error('Windows signing manager is unavailable');
  const signingManager = await packager.signingManager.value;
  const toolInfo = await getSignTool(signingManager, isWindows);
  const args = signingManager.computeSignToolArgs({ ...configuration, cscInfo }, isWindows);

  console.log(`  * signing         file=${configuration.path} certificateFile=${path.relative(__dirname, certificateFile)}`);
  await runSignTool(toolInfo.path, args, toolInfo.env, password);
  return true;
};
