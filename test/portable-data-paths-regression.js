#!/usr/bin/env node

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
	PORTABLE_DATA_FOLDER_NAME,
	PORTABLE_PROFILE_MARKER_NAME,
	PORTABLE_COPY_REQUEST_NAME,
	resolveEarlyDataPaths,
	prepareEarlyDataPaths,
	initializePortableProfile,
	writePortableCopyRequest,
	consumePortableCopyRequest,
} = require('../portable-data-paths');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-capture-portable-paths-'));

try {
	assert.strictEqual(resolveEarlyDataPaths({}, 'win32'), null);
	assert.strictEqual(resolveEarlyDataPaths({ PORTABLE_EXECUTABLE_DIR: tempRoot }, 'linux'), null);

	const portable = resolveEarlyDataPaths({ PORTABLE_EXECUTABLE_DIR: tempRoot }, 'win32');
	assert.strictEqual(portable.mode, 'portable');
	assert.strictEqual(portable.dataRoot, path.join(tempRoot, PORTABLE_DATA_FOLDER_NAME));
	assert.strictEqual(portable.userData, path.join(portable.dataRoot, 'profile'));
	assert.strictEqual(portable.sessionData, portable.userData);
	prepareEarlyDataPaths(portable);
	for (const directory of [portable.userData, portable.logs, portable.crashes]) {
		assert.strictEqual(fs.statSync(directory).isDirectory(), true, `${directory} was not created`);
	}
	assert.match(fs.readFileSync(path.join(portable.dataRoot, 'README.txt'), 'utf8'), /Defender scans or Prefetch/);

	const legacyDir = path.join(tempRoot, 'legacy-profile');
	fs.mkdirSync(path.join(legacyDir, 'Local Storage'), { recursive: true });
	fs.writeFileSync(path.join(legacyDir, 'config.json'), JSON.stringify({ migrated: true }));
	fs.writeFileSync(path.join(legacyDir, 'Local Storage', 'state.txt'), 'session-state');
	fs.writeFileSync(path.join(legacyDir, 'SingletonLock'), 'stale-lock');
	fs.mkdirSync(path.join(legacyDir, 'Cache'), { recursive: true });
	fs.writeFileSync(path.join(legacyDir, 'Cache', 'stale-cache'), 'disposable');

	const migration = initializePortableProfile(portable, { legacyUserData: legacyDir });
	assert.strictEqual(migration.action, 'pending');
	writePortableCopyRequest(portable);
	fs.writeFileSync(path.join(portable.userData, 'created-before-restart.txt'), 'discard me');
	const consumed = consumePortableCopyRequest(portable, legacyDir);
	assert.strictEqual(consumed.action, 'copy');
	assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(portable.userData, 'config.json'), 'utf8')), { migrated: true });
	assert.strictEqual(fs.readFileSync(path.join(portable.userData, 'Local Storage', 'state.txt'), 'utf8'), 'session-state');
	assert.strictEqual(fs.existsSync(path.join(portable.userData, 'SingletonLock')), false);
	assert.strictEqual(fs.existsSync(path.join(portable.userData, 'Cache')), false);
	assert.strictEqual(fs.existsSync(path.join(portable.userData, 'created-before-restart.txt')), false);
	assert.strictEqual(fs.existsSync(path.join(portable.dataRoot, PORTABLE_COPY_REQUEST_NAME)), false);
	assert.strictEqual(fs.existsSync(path.join(portable.dataRoot, PORTABLE_PROFILE_MARKER_NAME)), true);
	assert.strictEqual(fs.readFileSync(path.join(legacyDir, 'config.json'), 'utf8'), JSON.stringify({ migrated: true }));
	assert.strictEqual(initializePortableProfile(portable, { legacyUserData: legacyDir, choice: 'fresh' }).action, 'already-initialized');

	const freshRoot = path.join(tempRoot, 'fresh-bundle');
	const fresh = resolveEarlyDataPaths({ PORTABLE_EXECUTABLE_DIR: freshRoot }, 'win32');
	prepareEarlyDataPaths(fresh);
	assert.strictEqual(initializePortableProfile(fresh, { legacyUserData: legacyDir }).action, 'pending');
	assert.strictEqual(initializePortableProfile(fresh, { legacyUserData: legacyDir, choice: 'fresh' }).action, 'fresh');
	assert.strictEqual(fs.existsSync(path.join(fresh.userData, 'config.json')), false);

	const automatedRoot = path.join(tempRoot, 'automated-copy');
	const automated = resolveEarlyDataPaths({ PORTABLE_EXECUTABLE_DIR: automatedRoot }, 'win32');
	prepareEarlyDataPaths(automated);
	assert.strictEqual(initializePortableProfile(automated, { legacyUserData: legacyDir, choice: 'copy' }).action, 'copy');
	assert.strictEqual(fs.existsSync(path.join(automated.userData, 'config.json')), true);

	const missingSourceRoot = path.join(tempRoot, 'missing-source-bundle');
	const missingSource = resolveEarlyDataPaths({ PORTABLE_EXECUTABLE_DIR: missingSourceRoot }, 'win32');
	prepareEarlyDataPaths(missingSource);
	writePortableCopyRequest(missingSource);
	assert.strictEqual(
		consumePortableCopyRequest(missingSource, path.join(tempRoot, 'does-not-exist')).action,
		'copy-source-missing',
	);
	assert.strictEqual(fs.existsSync(path.join(missingSource.dataRoot, PORTABLE_COPY_REQUEST_NAME)), false);
	assert.strictEqual(fs.existsSync(path.join(missingSource.dataRoot, PORTABLE_PROFILE_MARKER_NAME)), true);

	const explicitDir = path.join(tempRoot, 'explicit-profile');
	const explicit = resolveEarlyDataPaths({
		ELECTRON_CAPTURE_USER_DATA_DIR: explicitDir,
		PORTABLE_EXECUTABLE_DIR: path.join(tempRoot, 'ignored-portable-dir'),
	}, 'win32');
	assert.strictEqual(explicit.mode, 'explicit');
	assert.strictEqual(explicit.userData, explicitDir);
	prepareEarlyDataPaths(explicit);
	assert.strictEqual(fs.existsSync(path.join(explicitDir, 'README.txt')), false);

	const fileInsteadOfDirectory = path.join(tempRoot, 'not-a-directory');
	fs.writeFileSync(fileInsteadOfDirectory, 'occupied');
	assert.throws(
		() => prepareEarlyDataPaths(resolveEarlyDataPaths({ PORTABLE_EXECUTABLE_DIR: fileInsteadOfDirectory }, 'win32')),
		/ENOTDIR|EEXIST/,
	);

	console.log('Portable data path regression checks passed.');
} finally {
	fs.rmSync(tempRoot, { recursive: true, force: true });
}
