'use strict';

const assert = require('assert');
const {
	normalizeLinuxAppIdentity,
	applyLinuxDesktopIdentity,
	shouldAllowMultipleInstances,
	createBrowserWindowWithLinuxIdentity
} = require('../linux-app-identity');

function expectInvalid(value, messagePattern) {
	assert.throws(() => normalizeLinuxAppIdentity(value), messagePattern);
}

assert.strictEqual(normalizeLinuxAppIdentity(null), null);
assert.strictEqual(normalizeLinuxAppIdentity(undefined), null);
assert.deepStrictEqual(normalizeLinuxAppIdentity(' jellyfin '), {
	className: 'jellyfin',
	desktopName: 'jellyfin.desktop'
});
assert.deepStrictEqual(normalizeLinuxAppIdentity('Radarr.DESKTOP'), {
	className: 'Radarr',
	desktopName: 'Radarr.desktop'
});
assert.deepStrictEqual(normalizeLinuxAppIdentity('Service Dashboard'), {
	className: 'Service Dashboard',
	desktopName: 'Service Dashboard.desktop'
});

expectInvalid('', /non-empty/);
expectInvalid('   ', /non-empty/);
expectInvalid('.', /non-empty/);
expectInvalid('..', /non-empty/);
expectInvalid('service/name', /not a path/);
expectInvalid('service\\name', /not a path/);
expectInvalid('service\nname', /control characters/);
expectInvalid(`service${String.fromCharCode(0)}name`, /control characters/);
expectInvalid('x'.repeat(248), /at most 247 UTF-8 bytes/);
expectInvalid(42, /must be a string/);
assert.strictEqual(normalizeLinuxAppIdentity('x'.repeat(247)).className.length, 247);

const desktopCalls = [];
const desktopApp = {
	setDesktopName(value) {
		desktopCalls.push(value);
	}
};
const identity = normalizeLinuxAppIdentity('portainer');
assert.strictEqual(applyLinuxDesktopIdentity(desktopApp, identity, 'linux'), true);
assert.deepStrictEqual(desktopCalls, ['portainer.desktop']);
assert.strictEqual(applyLinuxDesktopIdentity(desktopApp, identity, 'win32'), false);
assert.strictEqual(applyLinuxDesktopIdentity(desktopApp, null, 'linux'), false);
assert.throws(
	() => applyLinuxDesktopIdentity({}, identity, 'linux'),
	/does not support Linux desktop identities/
);

assert.strictEqual(shouldAllowMultipleInstances({}, null), false);
assert.strictEqual(shouldAllowMultipleInstances({ multiinstance: true }, null), true);
assert.strictEqual(shouldAllowMultipleInstances({ standalone: true }, null), true);
assert.strictEqual(shouldAllowMultipleInstances({}, identity), true);
assert.strictEqual(shouldAllowMultipleInstances(null, identity), true);

let currentAppName = 'elecap';
const appNameChanges = [];
const windowApp = {
	getName() {
		return currentAppName;
	},
	setName(value) {
		currentAppName = value;
		appNameChanges.push(value);
	}
};
class FakeBrowserWindow {
	constructor(options) {
		this.options = options;
		this.appNameDuringConstruction = currentAppName;
	}
}

const linuxWindow = createBrowserWindowWithLinuxIdentity(
	windowApp,
	FakeBrowserWindow,
	{ title: 'Portainer' },
	identity,
	'linux'
);
assert.strictEqual(linuxWindow.appNameDuringConstruction, 'portainer');
assert.strictEqual(linuxWindow.options.title, 'Portainer');
assert.strictEqual(currentAppName, 'elecap');
assert.deepStrictEqual(appNameChanges, ['portainer', 'elecap']);

appNameChanges.length = 0;
const windowsWindow = createBrowserWindowWithLinuxIdentity(
	windowApp,
	FakeBrowserWindow,
	{ title: 'Portainer' },
	identity,
	'win32'
);
assert.strictEqual(windowsWindow.appNameDuringConstruction, 'elecap');
assert.deepStrictEqual(appNameChanges, []);

class ThrowingBrowserWindow {
	constructor() {
		throw new Error('window creation failed');
	}
}
assert.throws(
	() => createBrowserWindowWithLinuxIdentity(windowApp, ThrowingBrowserWindow, {}, identity, 'linux'),
	/window creation failed/
);
assert.strictEqual(currentAppName, 'elecap');

console.log('linux-app-identity regression checks passed');
