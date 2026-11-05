'use strict';

// Opt-in override inside a disposable test process. Electron's ASAR resolver
// loads the actual unpacked native binary alongside the supplied package.
module.exports = function usePackagedNative(relative) {
  if (!process.env.VALIDATION_PACKAGED_APP) return;
  const path = require('node:path'), fs = require('original-fs'), Module = require('node:module');
  const archive = path.resolve(process.env.VALIDATION_PACKAGED_APP);
  if (!fs.statSync(archive).isFile() || path.basename(archive) !== 'app.asar') throw new Error('Expected extracted package app.asar');
  const source = require.resolve(path.resolve(__dirname, '../..', relative));
  const replacement = new Module(source, module);
  replacement.filename = source; replacement.loaded = true;
  replacement.exports = require(path.join(archive, relative));
  require.cache[source] = replacement;
};
