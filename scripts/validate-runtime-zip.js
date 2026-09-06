'use strict';

const path = require('node:path').posix;
const { promisify } = require('node:util');
const yauzl = require(require.resolve('yauzl', { paths: [require.resolve('extract-zip')] }));

// Electron's macOS bundle legitimately contains relative symlinks. Check the
// complete link graph before extraction so those remain supported while links
// cannot redirect extraction outside the new runtime directory.
function validateLinks(entries, links) {
  // ZIPs can spell the same path with './' or redundant separators. Match links
  // using the canonical destination rather than their raw archive spelling.
  links = new Map([...links].map(([name, target]) => [path.normalize(name).replace(/\/$/, ''), target]));
  function resolve(name, seen = new Set()) {
    if (/^[a-z]:|^[\\/]/i.test(name) || name.includes('\\')) throw new Error(`Unsafe ZIP path: ${name}`);
    const parts = name.split('/');
    const resolved = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!resolved.length) throw new Error(`ZIP symlink escapes runtime directory: ${name}`);
        resolved.pop(); continue;
      }
      resolved.push(part);
      const prefix = resolved.join('/');
      if (links.has(prefix)) {
        if (seen.has(prefix)) throw new Error(`Cyclic ZIP symlink: ${prefix}`);
        const target = links.get(prefix);
        if (/^[a-z]:|^[\\/]/i.test(target) || target.includes('\\') || target.includes('\0')) {
          throw new Error(`Unsafe ZIP symlink target: ${prefix}`);
        }
        const nextSeen = new Set(seen); nextSeen.add(prefix);
        return resolve([path.dirname(prefix), target, ...parts.slice(i + 1)].join('/'), nextSeen);
      }
    }
    return resolved.join('/');
  }
  for (const entry of entries) resolve(entry);
}

async function validateRuntimeZip(file) {
  const zip = await promisify(yauzl.open)(file, { lazyEntries: true });
  const entries = [], links = new Map(), names = new Set();
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', entry => {
        (async () => {
          const rawName = process.platform === 'win32' ? entry.fileName.toLowerCase() : entry.fileName;
          const name = path.normalize(rawName);
          // Multiple records for one path could overwrite a validated link.
          if (names.has(name) && !name.endsWith('/')) throw new Error(`Duplicate ZIP path: ${name}`);
          names.add(name);
          entries.push(name);
          if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) {
            if (entry.uncompressedSize > 65536) throw new Error('ZIP symlink target too long');
            const stream = await promisify(zip.openReadStream.bind(zip))(entry);
            const chunks = [];
            await new Promise((resolve, reject) => {
              stream.on('data', chunk => chunks.push(chunk));
              stream.on('end', resolve);
              stream.on('error', reject);
            });
            const target = Buffer.concat(chunks).toString('utf8');
            links.set(name, process.platform === 'win32' ? target.toLowerCase() : target);
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
    validateLinks(entries, links);
  } finally { zip.close(); }
}

module.exports = { validateRuntimeZip, validateLinks };
