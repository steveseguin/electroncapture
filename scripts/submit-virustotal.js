#!/usr/bin/env node

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const VT_API_BASE = 'https://www.virustotal.com/api/v3';
const DIRECT_UPLOAD_LIMIT_BYTES = 32 * 1024 * 1024;
const DEFAULT_SECRET_PATH = path.resolve(__dirname, '..', '.secret');

function loadLocalSecretEnv(secretPath = DEFAULT_SECRET_PATH) {
  let content = '';
  try {
    content = fs.readFileSync(secretPath, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function parseArgs(argv) {
  const options = { dir: path.resolve(process.cwd(), 'dist'), failOnError: false, requireApiKey: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dir') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --dir');
      options.dir = path.resolve(process.cwd(), value);
      index += 1;
    } else if (arg === '--fail-on-error') {
      options.failOnError = true;
    } else if (arg === '--require-api-key') {
      options.requireApiKey = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function getCurlCommand() {
  return process.platform === 'win32' ? 'curl.exe' : 'curl';
}

async function curlJson(args, apiKey) {
  const requestArgs = ['-sS', ...args, '-H', `x-apikey: ${apiKey}`];
  try {
    const { stdout } = await execFileAsync(getCurlCommand(), requestArgs, { maxBuffer: 10 * 1024 * 1024 });
    try {
      return JSON.parse(stdout);
    } catch (_) {
      throw new Error(`Unexpected VirusTotal response: ${stdout.slice(0, 400)}`);
    }
  } catch (error) {
    const details = String(error.stderr || error.stdout || error.message || error).trim();
    throw new Error(`curl request failed: ${details}`);
  }
}

function isCandidateArtifact(fileName) {
  const lowerName = fileName.toLowerCase();
  if (!lowerName.endsWith('.exe') || lowerName.includes('uninstall')) return false;
  return lowerName === 'elecap.exe' || /^elecap-[0-9][0-9a-z.-]*\.exe$/.test(lowerName);
}

async function listCandidateArtifacts(distDir) {
  try {
    const entries = await fs.promises.readdir(distDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isCandidateArtifact(entry.name))
      .map((entry) => path.join(distDir, entry.name))
      .sort();
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function getUploadUrl(apiKey, sizeBytes) {
  if (sizeBytes <= DIRECT_UPLOAD_LIMIT_BYTES) return `${VT_API_BASE}/files`;
  const payload = await curlJson([`${VT_API_BASE}/files/upload_url`], apiKey);
  if (!payload || typeof payload.data !== 'string' || !payload.data) {
    throw new Error('VirusTotal did not return a large-file upload URL');
  }
  return payload.data;
}

async function submitFile(filePath, apiKey) {
  const stats = await fs.promises.stat(filePath);
  const uploadUrl = await getUploadUrl(apiKey, stats.size);
  return curlJson(['-X', 'POST', uploadUrl, '-F', `file=@${filePath}`], apiKey);
}

async function collectUniqueArtifacts(distDir) {
  const files = await listCandidateArtifacts(distDir);
  const seenHashes = new Set();
  const uniqueFiles = [];
  for (const filePath of files) {
    const sha256 = await hashFile(filePath);
    if (seenHashes.has(sha256)) {
      console.log(`[VirusTotal] Skipping duplicate bytes for ${path.basename(filePath)} (${sha256})`);
      continue;
    }
    seenHashes.add(sha256);
    uniqueFiles.push({ filePath, sha256 });
  }
  return uniqueFiles;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  loadLocalSecretEnv();
  const apiKey = String(process.env.VIRUSTOTAL_API_KEY || process.env.VT_API_KEY || '').trim();
  if (!apiKey) {
    if (options.requireApiKey) throw new Error('VirusTotal API key is required but not configured');
    console.log('[VirusTotal] API key not set; skipping submission');
    return;
  }

  const artifacts = await collectUniqueArtifacts(options.dir);
  if (!artifacts.length) {
    console.log(`[VirusTotal] No Windows executables found in ${options.dir}; skipping submission`);
    return;
  }

  console.log(`[VirusTotal] Submitting ${artifacts.length} artifact(s) from ${options.dir}`);
  let hadError = false;
  for (const artifact of artifacts) {
    const baseName = path.basename(artifact.filePath);
    try {
      const payload = await submitFile(artifact.filePath, apiKey);
      const analysisId = payload && payload.data && payload.data.id ? payload.data.id : 'unknown';
      console.log(`[VirusTotal] Submitted ${baseName}; analysis=${analysisId}`);
      console.log(`[VirusTotal] Report URL: https://www.virustotal.com/gui/file/${artifact.sha256}`);
    } catch (error) {
      hadError = true;
      console.warn(`[VirusTotal] Failed to submit ${baseName}: ${error.message || error}`);
    }
  }
  if (hadError && options.failOnError) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[VirusTotal] ${error.message || error}`);
  process.exitCode = 1;
});
