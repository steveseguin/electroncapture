'use strict';

const fs = require('fs');
const path = require('path');

const PORTABLE_DATA_FOLDER_NAME = 'ElectronCapture-data';
const PORTABLE_PROFILE_MARKER_NAME = '.profile-initialized.json';
const PORTABLE_COPY_REQUEST_NAME = '.copy-profile-on-next-start.json';
const MIGRATION_EXCLUDED_NAMES = new Set([
	'SingletonLock',
	'SingletonSocket',
	'SingletonCookie',
	'DevTools Active Port',
	'LOCK',
	'Cache',
	'Code Cache',
	'GPUCache',
	'DawnCache',
	'ShaderCache',
	'GrShaderCache',
	'Crashpad',
]);
const PORTABLE_DATA_README = `Electron Capture portable data
================================

This folder contains the portable app's settings, browser sessions, cache, logs, and crash reports.

Keep this folder beside elecap.exe. You can replace the EXE during an update without losing these
files, or move the EXE and this folder together.

Important limitations:
- Saved sign-ins protected by Windows may require you to sign in again after moving to another computer or Windows account.
- Local media and custom file selections still point to their original locations. Move those files separately or relink them.
- Windows itself may keep system-level records such as Defender scans or Prefetch entries outside this folder.
`;

function normalizeEnvironmentPath(value) {
	const normalized = String(value || '').trim();
	return normalized ? path.resolve(normalized) : '';
}

function resolveEarlyDataPaths(environment = process.env, platform = process.platform) {
	const explicitUserDataDir = normalizeEnvironmentPath(environment.ELECTRON_CAPTURE_USER_DATA_DIR);
	if (explicitUserDataDir) {
		return {
			mode: 'explicit',
			dataRoot: explicitUserDataDir,
			userData: explicitUserDataDir,
			sessionData: explicitUserDataDir,
			logs: path.join(explicitUserDataDir, 'logs'),
			crashes: path.join(explicitUserDataDir, 'crashes'),
		};
	}

	const portableExecutableDir = normalizeEnvironmentPath(environment.PORTABLE_EXECUTABLE_DIR);
	if (platform !== 'win32' || !portableExecutableDir) return null;

	const dataRoot = path.join(portableExecutableDir, PORTABLE_DATA_FOLDER_NAME);
	const profile = path.join(dataRoot, 'profile');
	return {
		mode: 'portable',
		dataRoot,
		userData: profile,
		sessionData: profile,
		logs: path.join(dataRoot, 'logs'),
		crashes: path.join(dataRoot, 'crashes'),
	};
}

function verifyDirectoryWritable(directory) {
	const probePath = path.join(
		directory,
		`.electron-capture-write-test-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
	);
	let descriptor = null;
	try {
		descriptor = fs.openSync(probePath, 'wx');
	} finally {
		if (descriptor !== null) fs.closeSync(descriptor);
		try {
			fs.unlinkSync(probePath);
		} catch (_) { }
	}
}

function writePortableReadme(dataRoot) {
	const readmePath = path.join(dataRoot, 'README.txt');
	try {
		fs.writeFileSync(readmePath, PORTABLE_DATA_README, { encoding: 'utf8', flag: 'wx' });
	} catch (error) {
		if (!error || error.code !== 'EEXIST') throw error;
	}
}

function directoryHasData(directory) {
	try {
		return fs.readdirSync(directory).length > 0;
	} catch (_) {
		return false;
	}
}

function assertPortableProfileTarget(paths) {
	if (!paths || paths.mode !== 'portable') {
		throw new Error('Portable profile operations require portable data paths.');
	}
	const expectedProfile = path.resolve(paths.dataRoot, 'profile');
	const actualProfile = path.resolve(paths.userData);
	if (actualProfile !== expectedProfile || actualProfile === path.parse(actualProfile).root) {
		throw new Error(`Refusing to replace unexpected portable profile path: ${actualProfile}`);
	}
}

function copyLegacyProfile(sourceDirectory, destinationDirectory) {
	for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
		if (MIGRATION_EXCLUDED_NAMES.has(entry.name)) continue;
		const sourcePath = path.join(sourceDirectory, entry.name);
		const destinationPath = path.join(destinationDirectory, entry.name);
		fs.cpSync(sourcePath, destinationPath, {
			recursive: true,
			force: true,
			filter: (candidate) => !MIGRATION_EXCLUDED_NAMES.has(path.basename(candidate)),
		});
	}
}

function markPortableProfileInitialized(paths, action) {
	const markerPath = path.join(paths.dataRoot, PORTABLE_PROFILE_MARKER_NAME);
	fs.writeFileSync(markerPath, JSON.stringify({
		action,
		initializedAt: new Date().toISOString(),
	}, null, 2));
}

function writePortableCopyRequest(paths) {
	assertPortableProfileTarget(paths);
	const requestPath = path.join(paths.dataRoot, PORTABLE_COPY_REQUEST_NAME);
	fs.writeFileSync(requestPath, JSON.stringify({ requestedAt: new Date().toISOString() }, null, 2));
}

function consumePortableCopyRequest(paths, legacyUserData) {
	if (!paths || paths.mode !== 'portable') return { action: 'not-portable' };
	const requestPath = path.join(paths.dataRoot, PORTABLE_COPY_REQUEST_NAME);
	if (!fs.existsSync(requestPath)) return { action: 'none' };

	assertPortableProfileTarget(paths);
	const sourceDirectory = normalizeEnvironmentPath(legacyUserData);
	if (!sourceDirectory || path.resolve(sourceDirectory) === path.resolve(paths.userData) || !directoryHasData(sourceDirectory)) {
		fs.unlinkSync(requestPath);
		markPortableProfileInitialized(paths, 'copy-source-missing');
		return { action: 'copy-source-missing' };
	}

	fs.rmSync(paths.userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
	fs.mkdirSync(paths.userData, { recursive: true });
	copyLegacyProfile(sourceDirectory, paths.userData);
	markPortableProfileInitialized(paths, 'copy');
	fs.unlinkSync(requestPath);
	return { action: 'copy', legacyUserData: sourceDirectory };
}

function initializePortableProfile(paths, options = {}) {
	if (!paths || paths.mode !== 'portable') return { action: 'not-portable' };
	const markerPath = path.join(paths.dataRoot, PORTABLE_PROFILE_MARKER_NAME);
	if (fs.existsSync(markerPath)) return { action: 'already-initialized' };

	if (directoryHasData(paths.userData)) {
		markPortableProfileInitialized(paths, 'existing');
		return { action: 'existing' };
	}

	const legacyUserData = normalizeEnvironmentPath(options.legacyUserData);
	if (!legacyUserData || path.resolve(legacyUserData) === path.resolve(paths.userData) || !directoryHasData(legacyUserData)) {
		markPortableProfileInitialized(paths, 'new');
		return { action: 'new' };
	}

	const requestedChoice = String(options.choice || '').trim().toLowerCase();
	if (requestedChoice !== 'copy' && requestedChoice !== 'fresh') {
		return { action: 'pending', legacyUserData };
	}
	if (requestedChoice === 'copy') {
		copyLegacyProfile(legacyUserData, paths.userData);
	}

	markPortableProfileInitialized(paths, requestedChoice);
	return { action: requestedChoice, legacyUserData };
}

function prepareEarlyDataPaths(paths) {
	if (!paths) return;
	const directories = [...new Set([paths.dataRoot, paths.userData, paths.sessionData, paths.logs, paths.crashes])];
	for (const directory of directories) {
		fs.mkdirSync(directory, { recursive: true });
		verifyDirectoryWritable(directory);
	}
	if (paths.mode === 'portable') writePortableReadme(paths.dataRoot);
}

module.exports = {
	PORTABLE_DATA_FOLDER_NAME,
	PORTABLE_PROFILE_MARKER_NAME,
	PORTABLE_COPY_REQUEST_NAME,
	resolveEarlyDataPaths,
	prepareEarlyDataPaths,
	initializePortableProfile,
	copyLegacyProfile,
	markPortableProfileInitialized,
	writePortableCopyRequest,
	consumePortableCopyRequest,
};
