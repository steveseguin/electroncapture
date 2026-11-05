#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getCurrentFuseWire, FuseState, FuseV1Options } = require('@electron/fuses');

if (process.platform !== 'darwin') {
    throw new Error('The macOS package verifier must run on macOS.');
}

const projectRoot = path.resolve(__dirname, '..');
const distDir = process.env.ELECTRON_CAPTURE_DIST_DIR
    ? path.resolve(process.env.ELECTRON_CAPTURE_DIST_DIR)
    : path.join(projectRoot, 'dist');
const packageJson = require(path.join(projectRoot, 'package.json'));
const productName = packageJson.build.productName;
const appPath = path.join(distDir, 'mac-universal', `${productName}.app`);

assertDirectory(appPath, 'universal macOS app bundle');

const artifacts = fs.readdirSync(distDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name);

assertArtifact(artifacts, '.dmg');
assertArtifact(artifacts, '.zip');

const executablePath = path.join(appPath, 'Contents', 'MacOS', productName);
assertFile(executablePath, 'main macOS executable');

const architectures = run('lipo', ['-archs', executablePath]).split(/\s+/);
for (const architecture of ['x86_64', 'arm64']) {
    if (!architectures.includes(architecture)) {
        throw new Error(`macOS executable is missing the ${architecture} architecture.`);
    }
}

run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
const signatureDetails = run('codesign', ['--display', '--verbose=4', appPath]);
const signatureLines = signatureDetails.split(/\r?\n/).map(line => line.trim());
if (!signatureLines.some(line => line.startsWith('Authority=Developer ID Application:'))) {
    throw new Error('The macOS app is not signed with a Developer ID Application certificate.');
}

const identifierLine = signatureLines.find(line => line.startsWith('Identifier='));
if (!identifierLine || identifierLine.slice('Identifier='.length) !== packageJson.build.appId) {
    throw new Error('The macOS signature identifier does not match build.appId.');
}

const expectedTeamId = process.env.APPLE_TEAM_ID;
if (expectedTeamId) {
    const teamLine = signatureLines.find(line => line.startsWith('TeamIdentifier='));
    const actualTeamId = teamLine && teamLine.slice('TeamIdentifier='.length);
    if (actualTeamId !== expectedTeamId) {
        throw new Error('The macOS signature TeamIdentifier does not match APPLE_TEAM_ID.');
    }
}

run('xcrun', ['stapler', 'validate', appPath]);

verifyFuses().then(() => {
    console.log(`Verified signed and notarized universal macOS package: ${path.relative(projectRoot, appPath)}`);
}).catch(error => {
    console.error(error);
    process.exitCode = 1;
});

async function verifyFuses() {
    // The fuses live in the framework, not the small Contents/MacOS launcher.
    // Inspect both architecture slices; reading the universal file directly
    // checks only the first fuse wire.
    const framework = path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework');
    const temporary = fs.mkdtempSync(path.join(require('os').tmpdir(), 'elecap-macos-fuses-'));
    try {
        for (const architecture of ['x86_64', 'arm64']) {
            const binary = path.join(temporary, architecture);
            run('lipo', [framework, '-thin', architecture, '-output', binary]);
            const wire = await getCurrentFuseWire(binary);
            for (const name of ['RunAsNode', 'EnableNodeOptionsEnvironmentVariable', 'EnableNodeCliInspectArguments']) {
                if (wire[FuseV1Options[name]] !== FuseState.DISABLE) {
                    throw new Error(`${architecture}: ${name} must be disabled.`);
                }
            }
            if (wire[FuseV1Options.EnableCookieEncryption] !== FuseState.ENABLE) {
                throw new Error(`${architecture}: cookie encryption must be enabled.`);
            }
            console.log(`Verified security fuses for ${architecture}.`);
            fs.unlinkSync(binary);
        }
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

function assertArtifact(names, extension) {
    const matching = names.filter(name => name.toLowerCase().endsWith(extension));
    if (matching.length === 0) {
        throw new Error(`No ${extension} artifact was found in dist.`);
    }

    for (const name of matching) {
        assertFile(path.join(distDir, name), `${extension} artifact`);
    }
}

function assertDirectory(targetPath, description) {
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isDirectory()) {
        throw new Error(`Missing ${description}: ${targetPath}`);
    }
}

function assertFile(targetPath, description) {
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile() || fs.statSync(targetPath).size === 0) {
        throw new Error(`Missing or empty ${description}: ${targetPath}`);
    }
}

function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error) {
        throw result.error;
    }

    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    if (result.status !== 0) {
        throw new Error(`${command} failed with exit code ${result.status}:\n${output}`);
    }
    return output;
}
