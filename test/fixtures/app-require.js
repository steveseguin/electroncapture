'use strict';

// Exercise an extracted release payload with the matching custom runtime.
// The parent Node launcher still resolves its runtime from the checkout.
const path = require('node:path');
let root = path.resolve(__dirname, '../..');
if (process.versions.electron && process.env.VALIDATION_PACKAGED_APP) {
  root = path.resolve(process.env.VALIDATION_PACKAGED_APP);
  if (path.basename(root) !== 'app.asar' || !require('original-fs').statSync(root).isFile()) {
    throw new Error('Expected an extracted release app.asar');
  }
}
module.exports = require('node:module').createRequire(path.join(root, 'package.json'));
