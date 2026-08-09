'use strict';

const DESKTOP_SUFFIX = '.desktop';
const MAX_DESKTOP_NAME_BYTES = 255;

function normalizeLinuxAppIdentity(rawValue) {
	if (rawValue === null || typeof rawValue === 'undefined') {
		return null;
	}
	if (typeof rawValue !== 'string') {
		throw new TypeError('--class must be a string.');
	}

	let className = rawValue.trim();
	if (className.toLowerCase().endsWith(DESKTOP_SUFFIX)) {
		className = className.slice(0, -DESKTOP_SUFFIX.length);
	}

	if (!className || className === '.' || className === '..') {
		throw new Error('--class must contain a non-empty application identity.');
	}
	if (/[\u0000-\u001f\u007f]/.test(className)) {
		throw new Error('--class cannot contain control characters.');
	}
	if (/[\\/]/.test(className)) {
		throw new Error('--class must be a desktop filename, not a path.');
	}

	const desktopName = `${className}${DESKTOP_SUFFIX}`;
	if (Buffer.byteLength(desktopName, 'utf8') > MAX_DESKTOP_NAME_BYTES) {
		throw new Error(`--class must be at most ${MAX_DESKTOP_NAME_BYTES - DESKTOP_SUFFIX.length} UTF-8 bytes.`);
	}

	return Object.freeze({
		className,
		desktopName
	});
}

function applyLinuxDesktopIdentity(app, identity, platform = process.platform) {
	if (platform !== 'linux' || !identity) {
		return false;
	}
	if (!app || typeof app.setDesktopName !== 'function') {
		throw new Error('This Electron runtime does not support Linux desktop identities.');
	}

	app.setDesktopName(identity.desktopName);
	return true;
}

function shouldAllowMultipleInstances(args, identity) {
	return !!identity || !!args && (args.multiinstance === true || args.standalone === true);
}

function createBrowserWindowWithLinuxIdentity(app, BrowserWindow, options, identity, platform = process.platform) {
	if (platform !== 'linux' || !identity) {
		return new BrowserWindow(options);
	}
	if (!app || typeof app.getName !== 'function' || typeof app.setName !== 'function') {
		throw new Error('This Electron runtime cannot set the Linux window class.');
	}

	// Electron 39 reads app.getName() for WM_CLASS during BrowserWindow construction.
	const originalName = app.getName();
	app.setName(identity.className);
	try {
		return new BrowserWindow(options);
	} finally {
		app.setName(originalName);
	}
}

module.exports = {
	normalizeLinuxAppIdentity,
	applyLinuxDesktopIdentity,
	shouldAllowMultipleInstances,
	createBrowserWindowWithLinuxIdentity
};
