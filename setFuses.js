const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');
const path = require('path');
const fs = require('fs');

async function setFuses(buildPath, electronBinaryPath) {
  console.log('Setting Electron fuses for enhanced security...');
  console.log('Binary path:', electronBinaryPath);
  
  try {
    await flipFuses(electronBinaryPath, {
      version: FuseVersion.V1,
      // CRITICAL: Disable RunAsNode to prevent ELECTRON_RUN_AS_NODE bypass
      [FuseV1Options.RunAsNode]: false,
      
      // Disable node options environment variable (prevents NODE_OPTIONS injection)
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      
      // Disable node CLI inspect arguments (prevents --inspect attacks)
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      
      // Enable cookie encryption for better security
      [FuseV1Options.EnableCookieEncryption]: true,
      
      // Keep these as default for compatibility
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      
      // Keep this enabled as your app uses file:// protocol
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: true
    });
    
    console.log('✓ Fuses set successfully');
  } catch (error) {
    console.error('✗ Error setting fuses:', error);
    throw error;
  }
}

module.exports = { setFuses };