'use strict';

const fs = require('fs');
const path = require('path');

const base = require('./package.json').build;
const electronVersion = '43.3.0-qp20';
const electronFilename = `electron-v${electronVersion}-win32-x64.zip`;

process.env.ELECTRON_CAPTURE_WINDOWS_VARIANT = 'win11';

function resolveLocalElectronDist() {
  const explicitZip = process.env.CUSTOM_ELECTRON_WIN11_ZIP;
  if (explicitZip) {
    const resolvedZip = path.resolve(explicitZip);
    if (path.basename(resolvedZip) !== electronFilename) {
      throw new Error(`CUSTOM_ELECTRON_WIN11_ZIP must point to ${electronFilename}`);
    }
    if (!fs.existsSync(resolvedZip)) {
      throw new Error(`Custom Electron ZIP not found: ${resolvedZip}`);
    }
    return path.dirname(resolvedZip);
  }

  const localDir = process.env.CUSTOM_ELECTRON_LOCAL_DIR;
  if (!localDir) {
    return undefined;
  }

  const candidate = path.resolve(localDir, electronFilename);
  return fs.existsSync(candidate) ? path.resolve(localDir) : undefined;
}

module.exports = {
  ...base,
  electronVersion,
  electronDist: resolveLocalElectronDist(),
  electronDownload: {
    mirror: 'https://github.com/steveseguin/electron/releases/download/',
    customDir: `v${electronVersion}`
  },
  nsis: {
    ...base.nsis,
    artifactName: 'elecap-${version}-win11.${ext}'
  },
  portable: {
    ...base.portable,
    artifactName: 'elecap-win11.exe'
  }
};
