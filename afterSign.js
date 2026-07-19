const fs = require('fs');
const path = require('path');

module.exports = async function (params) {
    // Only notarize the app on Mac OS only.
    if (params.electronPlatformName !== 'darwin') {
        return;
    }

    const appleId = process.env.APPLE_ID || process.env.appleId;
    const teamId = process.env.APPLE_TEAM_ID || process.env.teamId;
    const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD || process.env.appleIdPassword;

    const configuredCredentialCount = [appleId, teamId, appleIdPassword].filter(Boolean).length;
    if (configuredCredentialCount === 0) {
        console.log('Skipping notarization - Apple credentials are not configured.');
        return;
    }

    if (configuredCredentialCount !== 3) {
        const missing = [];
        if (!appleId) missing.push('APPLE_ID');
        if (!teamId) missing.push('APPLE_TEAM_ID');
        if (!appleIdPassword) missing.push('APPLE_APP_SPECIFIC_PASSWORD');
        throw new Error(`Cannot notarize because these environment variables are missing: ${missing.join(', ')}`);
    }

    let notarize;
    try {
        ({ notarize } = require('@electron/notarize'));
    } catch (error) {
        throw new Error('@electron/notarize is required for macOS notarization.');
    }

    // Keep this aligned with build.appId in package.json.
    const appId = params.packager.config.appId || require('./package.json').build.appId;

    let appPath = path.join(params.appOutDir, `${params.packager.appInfo.productFilename}.app`);
    if (!fs.existsSync(appPath)) {
        throw new Error(`Cannot find application at: ${appPath}`);
    }

    console.log(`Notarizing ${appId} found at ${appPath}`);

    await notarize({
        appPath: appPath,
        appleId,
        teamId,
        appleIdPassword,
    });

    console.log(`Done notarizing ${appId}`);
};
