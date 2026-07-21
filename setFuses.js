const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

async function setFuses(buildPath, electronBinaryPath) {
  console.log('Setting Electron fuses for enhanced security...');
  console.log('Binary path:', electronBinaryPath);

  try {
    await flipFuses(electronBinaryPath, {
      version: FuseVersion.V1,
      // Disable RunAsNode to prevent ELECTRON_RUN_AS_NODE bypass.
      [FuseV1Options.RunAsNode]: false,
      // Prevent NODE_OPTIONS injection.
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      // Prevent --inspect arguments from enabling a debugger.
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      // Encrypt browser cookies at rest where the platform supports it.
      [FuseV1Options.EnableCookieEncryption]: true,
      // Preserve existing compatibility choices.
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
      [FuseV1Options.OnlyLoadAppFromAsar]: false,
      [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]: true
    });

    console.log('Fuses set successfully');
  } catch (error) {
    console.error('Error setting fuses:', error);
    throw error;
  }
}

module.exports = { setFuses };
