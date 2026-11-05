'use strict';

// Preserve electron-is-dev 2's override semantics without an ESM dependency.
function isDevelopment(app, env = process.env) {
  return 'ELECTRON_IS_DEV' in env
    ? Number.parseInt(env.ELECTRON_IS_DEV, 10) === 1
    : !app.isPackaged;
}

module.exports = { isDevelopment };
