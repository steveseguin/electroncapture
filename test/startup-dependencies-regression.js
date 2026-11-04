'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const metadata = require('../package.json');
const lock = require('../package-lock.json');

// main.js initializes Electron synchronously before app.ready. These packages
// must keep their callable CommonJS API until startup is migrated deliberately.
const compatibleVersions = {
  'electron-context-menu': '3.6.1',
  'electron-unhandled': '4.0.1',
};
for (const [name, version] of Object.entries(compatibleVersions)) {
  assert.equal(metadata.dependencies[name], version, `${name} must stay pinned to the supported CommonJS version`);
  assert.equal(lock.packages[''].dependencies[name], version);
  assert.equal(lock.packages[`node_modules/${name}`].version, version);
}

if (!process.argv.includes('--metadata-only')) {
  // Load the actual installed dependency graph, with only Electron stubbed.
  // This catches ESM/top-level-await regressions without launching an app,
  // touching the user's profile, or registering exception handlers.
  const originalLoad = Module._load;
  const electron = {
    app: { name: 'Startup dependency test', isPackaged: true, getName: () => 'Startup dependency test' },
    ipcMain: { handle() {} },
    dialog: {},
    clipboard: {},
  };
  try {
    Module._load = function (request, parent, isMain) {
      return request === 'electron' ? electron : originalLoad.call(this, request, parent, isMain);
    };
    for (const name of Object.keys(compatibleVersions)) {
      assert.equal(typeof require(name), 'function', `${name} must be callable from require()`);
    }
  } finally {
    Module._load = originalLoad;
  }
}

console.log(`Startup dependency ${process.argv.includes('--metadata-only') ? 'metadata ' : ''}checks passed`);
