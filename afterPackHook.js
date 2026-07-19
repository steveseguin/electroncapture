const { setFuses } = require('./setFuses');
const path = require('path');
const fs = require('fs');

exports.default = async function(context) {
  // Get the Electron binary path based on platform
  const { appOutDir, packager, electronPlatformName } = context;
  const { productFilename } = packager.appInfo;
  
  let electronBinaryPath;
  
  if (electronPlatformName === 'darwin') {
    // macOS
    electronBinaryPath = path.join(appOutDir, `${productFilename}.app`, 'Contents', 'MacOS', productFilename);
  } else if (electronPlatformName === 'win32') {
    // Windows
    electronBinaryPath = path.join(appOutDir, `${productFilename}.exe`);
  } else {
    // Linux
    electronBinaryPath = path.join(appOutDir, productFilename);
  }
  
  // Check if the binary exists
  if (!fs.existsSync(electronBinaryPath)) {
    const contents = fs.existsSync(appOutDir) ? fs.readdirSync(appOutDir) : [];
    throw new Error(`Electron binary not found at: ${electronBinaryPath}. appOutDir contains: ${contents.join(', ')}`);
  }

  // Fuse failures are security failures and must stop the package build.
  await setFuses(appOutDir, electronBinaryPath);
};
