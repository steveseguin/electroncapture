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
    console.error(`Electron binary not found at: ${electronBinaryPath}`);
    console.log('Contents of appOutDir:', fs.readdirSync(appOutDir));
    return;
  }
  
  // Apply fuses
  try {
    await setFuses(appOutDir, electronBinaryPath);
  } catch (error) {
    console.error('Failed to set fuses:', error);
    // Don't fail the build, but log the error
  }
};