// Modules to control application life and create native browser window
const electron = require('electron')
const process = require('process')
const prompt = require('electron-prompt');
const unhandled = require('electron-unhandled');
const fs = require('fs');
const path = require('path');
const {app, BrowserWindow, BrowserView, webFrameMain, desktopCapturer, ipcMain, screen, shell, globalShortcut, session, dialog} = require('electron')
const contextMenu = require('electron-context-menu');
const Yargs = require('yargs')
const isDev = require('electron-is-dev');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const os = require('os');

ipcMain.on('getSources', async function(eventRet, args) {
	try{
		const sources = await desktopCapturer.getSources({ types: args.types });
		eventRet.returnValue = sources;
	} catch(e){console.error(e);}
});


const { Readable } = require('stream');
const { fetch: undiciFetch } = require('undici');
const activeStreams = new Map();
const https = require('https');
const { execSync } = require('child_process');
const STREAM_ID_WORDS = require('./assets/stream-id-words.json');

let windowAudioCapture = null;
let windowAudioCaptureAvailable = false;
const WINDOW_AUDIO_EVENT_CHANNEL = 'windowAudioStreamData';
let activeWindowAudioSession = null;
let cachedElevationState;

const namedWindowRegistry = new Map();

function normalizeWindowName(value) {
	if (typeof value !== 'string') {
		return null;
	}
	const trimmed = value.trim();
	return trimmed.length ? trimmed : null;
}

function getWindowRegistryKey(name) {
	const normalized = normalizeWindowName(name);
	return normalized ? normalized.toLowerCase() : null;
}

function getNamedWindowInstance(name) {
	const key = getWindowRegistryKey(name);
	if (!key) {
		return null;
	}
	const instance = namedWindowRegistry.get(key);
	if (instance && !instance.isDestroyed()) {
		return instance;
	}
	if (namedWindowRegistry.has(key)) {
		namedWindowRegistry.delete(key);
	}
	return null;
}

function registerNamedWindowInstance(windowInstance, name) {
	const key = getWindowRegistryKey(name);
	if (!key || !windowInstance) {
		return;
	}
	namedWindowRegistry.set(key, windowInstance);
	windowInstance.__namedWindowKey = key;
	windowInstance.once('closed', () => {
		if (namedWindowRegistry.get(key) === windowInstance) {
			namedWindowRegistry.delete(key);
		}
	});
}

function clearWindowCloseTimers(windowInstance) {
	if (!windowInstance) {
		return;
	}
	if (windowInstance.__pendingHangupTimeout) {
		clearTimeout(windowInstance.__pendingHangupTimeout);
		windowInstance.__pendingHangupTimeout = null;
	}
	if (windowInstance.__pendingDestroyTimeout) {
		clearTimeout(windowInstance.__pendingDestroyTimeout);
		windowInstance.__pendingDestroyTimeout = null;
	}
	windowInstance.__pendingCloseRequested = false;
}

function prepareWindowForReuse(windowInstance, options = {}) {
	if (!windowInstance || windowInstance.isDestroyed()) {
		return;
	}

	const shouldShow = options.show !== false;
	const initialState = {};
	try {
		initialState.isVisible = windowInstance.isVisible();
		initialState.isMinimized = windowInstance.isMinimized();
		initialState.bounds = windowInstance.getBounds();
	} catch (error) {
		console.warn('Unable to capture initial window state for reuse:', error);
	}
	console.log('Preparing window for reuse. Initial state:', initialState);

	try {
		if (windowInstance.isMinimized()) {
			windowInstance.restore();
			console.log('Restored minimized window prior to reuse.');
		}
	} catch (error) {
		console.warn('Failed to restore window prior to reuse:', error);
	}

	if (shouldShow) {
		try {
			if (!windowInstance.isVisible()) {
				windowInstance.showInactive();
				console.log('Window was hidden; showInactive() invoked prior to reuse.');
			}
		} catch (error) {
			console.warn('Failed to show window prior to reuse:', error);
		}
	}
}

function getImmutablePreferencesForWindow(windowInstance) {
	if (!windowInstance || typeof windowInstance !== 'object') {
		return null;
	}
	if (windowInstance.__immutableWebPreferences && typeof windowInstance.__immutableWebPreferences === 'object') {
		return windowInstance.__immutableWebPreferences;
	}
	if (typeof windowInstance.node === 'boolean') {
		const nodeEnabled = !!windowInstance.node;
		return {
			nodeIntegration: nodeEnabled,
			nodeIntegrationInSubFrames: nodeEnabled,
			contextIsolation: !nodeEnabled
		};
	}
	return null;
}

function immutablePreferencesMatch(existingWindow, requestedPreferences) {
	if (!requestedPreferences || typeof requestedPreferences !== 'object') {
		return true;
	}
	const existingPreferences = getImmutablePreferencesForWindow(existingWindow);
	if (!existingPreferences) {
		return false;
	}
	return Object.keys(requestedPreferences).every((key) => existingPreferences[key] === requestedPreferences[key]);
}

function getScaleFactorForWindow(targetWindow) {
	const fallbackScale = () => {
		const primary = getPrimaryDisplaySafe();
		return (primary && primary.scaleFactor) || 1;
	};

	if (!targetWindow || targetWindow.isDestroyed()) {
		return fallbackScale();
	}

	const boundsUsable = (rect) =>
		rect &&
		Number.isFinite(rect.width) &&
		Number.isFinite(rect.height) &&
		rect.width > 10 &&
		rect.height > 10;

	let display = null;
	let bounds = null;

	try {
		bounds = targetWindow.getBounds();
	} catch (error) {
		console.warn('Failed to read window bounds while resolving scale factor:', error);
	}

	if (boundsUsable(bounds)) {
		try {
			display = screen.getDisplayMatching(bounds);
		} catch (error) {
			console.warn('screen.getDisplayMatching failed for active bounds:', error);
		}
	}

	if (!display && typeof targetWindow.getNormalBounds === 'function') {
		try {
			const normalBounds = targetWindow.getNormalBounds();
			if (boundsUsable(normalBounds)) {
				display = screen.getDisplayMatching(normalBounds);
			}
		} catch (error) {
			console.warn('Unable to resolve display from normal bounds:', error);
		}
	}

	if (!display && targetWindow.__lastDisplayId) {
		const match = getAllDisplaysSorted().find((d) => d.id === targetWindow.__lastDisplayId);
		if (match) {
			display = match;
		}
	}

	if (!display) {
		display = getPrimaryDisplaySafe();
	}

	return (display && display.scaleFactor) || fallbackScale();
}

function getPrimaryDisplaySafe() {
	try {
		return screen.getPrimaryDisplay();
	} catch (error) {
		return null;
	}
}

function getAllDisplaysSorted() {
	const displays = screen.getAllDisplays();
	if (!Array.isArray(displays)) {
		return [];
	}
	return [...displays].sort((a, b) => a.id - b.id);
}

function getPhysicalBoundsForDisplay(display) {
	if (!display || !display.bounds) {
		return null;
	}
	const scaleFactor = display.scaleFactor || 1;
	return {
		x: Math.round(display.bounds.x * scaleFactor),
		y: Math.round(display.bounds.y * scaleFactor),
		width: Math.round(display.bounds.width * scaleFactor),
		height: Math.round(display.bounds.height * scaleFactor)
	};
}

function isUsableRect(rect) {
	return (
		rect &&
		Number.isFinite(rect.x) &&
		Number.isFinite(rect.y) &&
		Number.isFinite(rect.width) &&
		Number.isFinite(rect.height) &&
		rect.width > 10 &&
		rect.height > 10
	);
}

function getUsableWindowBounds(windowInstance, options = {}) {
	if (!windowInstance || windowInstance.isDestroyed()) {
		return null;
	}
	const preferNormal = options.preferNormal === true;
	const attempts = [];
	if (!preferNormal) {
		attempts.push(() => {
			try {
				return windowInstance.getBounds();
			} catch (error) {
				console.warn('Failed to read window bounds:', error);
				return null;
			}
		});
	}
	if (typeof windowInstance.getNormalBounds === 'function') {
		attempts.push(() => {
			try {
				return windowInstance.getNormalBounds();
			} catch (error) {
				console.warn('Failed to read normal window bounds:', error);
				return null;
			}
		});
	}
	if (preferNormal) {
		attempts.push(() => {
			try {
				return windowInstance.getBounds();
			} catch (error) {
				console.warn('Failed to read window bounds (fallback):', error);
				return null;
			}
		});
	}
	for (const readBounds of attempts) {
		const rect = readBounds();
		if (isUsableRect(rect)) {
			return rect;
		}
	}
	return null;
}

function rectanglesOverlap(a, b) {
	if (!a || !b) {
		return false;
	}
	return (
		a.x < b.x + b.width &&
		a.x + a.width > b.x &&
		a.y < b.y + b.height &&
		a.y + a.height > b.y
	);
}

function getDisplayWorkArea(display) {
	if (!display) {
		return null;
	}
	if (display.workArea && typeof display.workArea === 'object') {
		return display.workArea;
	}
	if (display.bounds && typeof display.bounds === 'object') {
		return display.bounds;
	}
	return null;
}

function findDisplayByPhysicalPoint(point) {
	if (!point) {
		return null;
	}
	const displays = getAllDisplaysSorted();
	for (const display of displays) {
		const bounds = getPhysicalBoundsForDisplay(display);
		if (!bounds) {
			continue;
		}
		if (
			point.x >= bounds.x &&
			point.x < bounds.x + bounds.width &&
			point.y >= bounds.y &&
			point.y < bounds.y + bounds.height
		) {
			return display;
		}
	}
	return null;
}

function resolveDisplayForArgs(args) {
	const displays = getAllDisplaysSorted();
	if (!displays.length) {
		return getPrimaryDisplaySafe();
	}

	if (typeof args.monitor === 'number' && !Number.isNaN(args.monitor) && args.monitor >= 0) {
		const index = Math.min(displays.length - 1, Math.floor(args.monitor));
		return displays[index];
	}

	const hasExplicitX = typeof args.x === 'number' && args.x !== -1;
	const hasExplicitY = typeof args.y === 'number' && args.y !== -1;
	if (hasExplicitX || hasExplicitY) {
		try {
			const physicalPoint = {
				x: hasExplicitX ? args.x : 0,
				y: hasExplicitY ? args.y : 0
			};
			const display = findDisplayByPhysicalPoint(physicalPoint);
			if (display) {
				return display;
			}
			const primaryScale = getPrimaryDisplaySafe()?.scaleFactor || 1;
			const dipPoint = {
				x: Math.round(physicalPoint.x / primaryScale),
				y: Math.round(physicalPoint.y / primaryScale)
			};
			const fallbackDisplay = screen.getDisplayNearestPoint(dipPoint);
			if (fallbackDisplay) {
				return fallbackDisplay;
			}
		} catch (error) {
			console.warn('Failed to resolve display from coordinates, falling back to primary:', error);
		}
	}

	return displays.find((display) => display.id === getPrimaryDisplaySafe()?.id) || displays[0];
}

function clampPhysicalSizeToDisplay(display, requestedWidth, requestedHeight) {
	const safeDisplay = display || getPrimaryDisplaySafe();
	const scaleFactor = (safeDisplay && safeDisplay.scaleFactor) || 1;
	const workArea = (safeDisplay && safeDisplay.workAreaSize) || (safeDisplay && safeDisplay.size);
	if (!workArea) {
		return {
			width: requestedWidth,
			height: requestedHeight
		};
	}

	const maxPhysicalWidth = Math.max(1, Math.round(workArea.width * scaleFactor));
	const maxPhysicalHeight = Math.max(1, Math.round(workArea.height * scaleFactor));
	let width = requestedWidth;
	let height = requestedHeight;

	if (typeof width === 'number' && typeof height === 'number') {
		if (width > maxPhysicalWidth) {
			height = Math.round(height * maxPhysicalWidth / width);
			width = maxPhysicalWidth;
		}
		if (height > maxPhysicalHeight) {
			width = Math.round(width * maxPhysicalHeight / height);
			height = maxPhysicalHeight;
		}
	} else if (typeof width === 'number' && width > maxPhysicalWidth) {
		width = maxPhysicalWidth;
	} else if (typeof height === 'number' && height > maxPhysicalHeight) {
		height = maxPhysicalHeight;
	}

	return { width, height };
}

function applyRequestedWindowSize(windowInstance, options = {}) {
	if (!windowInstance || windowInstance.isDestroyed()) {
		return;
	}
	const clampToWorkArea = !!options.clampToWorkArea;
	if (windowInstance.isDestroyed()) {
		return;
	}
	if (windowInstance.isFullScreen()) {
		return;
	}
	const requestedWidth = typeof windowInstance.args?.width === 'number' ? windowInstance.args.width : null;
	const requestedHeight = typeof windowInstance.args?.height === 'number' ? windowInstance.args.height : null;
	if (requestedWidth === null && requestedHeight === null) {
		console.log('applyRequestedWindowSize: no explicit width/height provided; skipping resize.');
		return;
	}

	const usableBounds = getUsableWindowBounds(windowInstance);
	let display;
	try {
		if (usableBounds) {
			display = screen.getDisplayMatching(usableBounds);
		} else {
			display = screen.getDisplayMatching(windowInstance.getBounds());
		}
	} catch (error) {
		display = getPrimaryDisplaySafe();
	}
	const scaleFactor = (display && display.scaleFactor) || 1;
	const currentSize = usableBounds ? [usableBounds.width, usableBounds.height] : windowInstance.getSize();
	let targetPhysicalWidth = requestedWidth !== null ? requestedWidth : currentSize[0] * scaleFactor;
	let targetPhysicalHeight = requestedHeight !== null ? requestedHeight : currentSize[1] * scaleFactor;

	if (clampToWorkArea) {
		const clamped = clampPhysicalSizeToDisplay(display, targetPhysicalWidth, targetPhysicalHeight);
		targetPhysicalWidth = requestedWidth !== null ? clamped.width : targetPhysicalWidth;
		targetPhysicalHeight = requestedHeight !== null ? clamped.height : targetPhysicalHeight;
	}

	const nextWidth = requestedWidth !== null ? Math.max(1, Math.round(targetPhysicalWidth / scaleFactor)) : currentSize[0];
	const nextHeight = requestedHeight !== null ? Math.max(1, Math.round(targetPhysicalHeight / scaleFactor)) : currentSize[1];

	console.log('applyRequestedWindowSize: computed resize', {
		requestedWidth,
		requestedHeight,
		scaleFactor,
		currentSize,
		targetPhysicalWidth,
		targetPhysicalHeight,
		nextWidth,
		nextHeight,
		displayId: display ? display.id : null
	});

	if (nextWidth !== currentSize[0] || nextHeight !== currentSize[1]) {
		const baseBounds = usableBounds || getUsableWindowBounds(windowInstance, { preferNormal: true });
		if (baseBounds) {
			windowInstance.setBounds({
				x: baseBounds.x,
				y: baseBounds.y,
				width: nextWidth,
				height: nextHeight
			});
		} else {
			windowInstance.setSize(nextWidth, nextHeight);
		}
	}
	windowInstance.__lastDisplayId = display ? display.id : windowInstance.__lastDisplayId;
}

function isWindowBoundsVisible(bounds) {
	if (!bounds) {
		return true;
	}
	const displays = getAllDisplaysSorted();
	if (!displays.length) {
		return true;
	}
	for (const display of displays) {
		const area = getDisplayWorkArea(display);
		if (!area) {
			continue;
		}
		if (rectanglesOverlap(bounds, area)) {
			return true;
		}
	}
	return false;
}

function repositionWindowToPrimaryDisplay(windowInstance, lastBounds) {
	const targetDisplay = getPrimaryDisplaySafe() || getAllDisplaysSorted()[0] || null;
	const workArea = getDisplayWorkArea(targetDisplay);
	if (!workArea) {
		try {
			console.log('No workArea available; centering window to keep visible.');
			windowInstance.center();
		} catch (error) {
			console.warn('Failed to center window while ensuring visibility:', error);
		}
		return;
	}
	const width = Math.max(
		200,
		Math.min(lastBounds?.width || workArea.width, workArea.width)
	);
	const height = Math.max(
		200,
		Math.min(lastBounds?.height || workArea.height, workArea.height)
	);
	const nextBounds = {
		x: workArea.x + Math.round((workArea.width - width) / 2),
		y: workArea.y + Math.round((workArea.height - height) / 2),
		width,
		height
	};
	try {
		console.log('Repositioning window to primary display with bounds:', nextBounds);
		windowInstance.setBounds(nextBounds);
	} catch (error) {
		console.warn('Failed to reposition window to primary display:', error);
	}
}

function ensureWindowVisible(windowInstance, options = {}) {
	if (!windowInstance || windowInstance.isDestroyed()) {
		return;
	}
	const shouldFocus = options.focus !== false;
	const forceShow = options.forceShow === true;
	const usableBounds = getUsableWindowBounds(windowInstance);
	const bounds = isUsableRect(usableBounds) ? usableBounds : null;
	if (bounds && !isWindowBoundsVisible(bounds)) {
		console.log('Window detected off-screen. Attempting to reposition.', bounds);
		repositionWindowToPrimaryDisplay(windowInstance, bounds);
	}

	if (windowInstance.isMinimized()) {
		try {
			windowInstance.restore();
		} catch (error) {
			console.warn('Failed to restore window while ensuring visibility:', error);
		}
	}

	if (!windowInstance.isVisible() || forceShow) {
		try {
			windowInstance.show();
		} catch (error) {
			console.warn('Failed to show window while ensuring visibility:', error);
		}
	}

	if (shouldFocus) {
		try {
			windowInstance.focus();
		} catch (error) {
			console.warn('Failed to focus window while ensuring visibility:', error);
		}
	}
}

function applyArgsToExistingWindow(windowInstance, args) {
	if (!windowInstance || windowInstance.isDestroyed()) {
		return false;
	}

	clearWindowCloseTimers(windowInstance);
	prepareWindowForReuse(windowInstance, { show: false });

		const mergedArgs = {
			...(windowInstance.args || {}),
			...args
		};
		windowInstance.args = mergedArgs;
		console.log('applyArgsToExistingWindow: merged args', {
			windowName: windowInstance.windowName || windowInstance.__namedWindowKey,
			width: mergedArgs.width,
			height: mergedArgs.height,
			x: mergedArgs.x,
			y: mergedArgs.y,
			min: mergedArgs.min,
			fullscreen: mergedArgs.fullscreen,
			pin: mergedArgs.pin
		});

		const factor = getScaleFactorForWindow(windowInstance);
		let loggedBounds = null;
		try {
			loggedBounds = windowInstance.getBounds();
			console.log('Reusing window bounds before applying args:', loggedBounds);
		} catch (error) {
			console.warn('Unable to read bounds before applying args:', error);
		}

	try {
		if (typeof mergedArgs.url === 'string' && mergedArgs.url.length) {
			const currentUrl = windowInstance.webContents.getURL();
			if (currentUrl !== mergedArgs.url) {
				windowInstance.webContents.loadURL(mergedArgs.url);
			}
		}

			const needsExplicitResize = typeof mergedArgs.width === 'number' || typeof mergedArgs.height === 'number';
			if (needsExplicitResize) {
				const isFullScreen = typeof windowInstance.isFullScreen === 'function' ? windowInstance.isFullScreen() : false;
				if (isFullScreen) {
					try {
						windowInstance.setFullScreen(false);
					} catch (error) {
						console.warn('Failed to exit fullscreen prior to resize:', error);
					}
				}
				const isMaximized = typeof windowInstance.isMaximized === 'function' ? windowInstance.isMaximized() : false;
				if (isMaximized) {
					try {
						windowInstance.unmaximize();
					} catch (error) {
						console.warn('Failed to unmaximize prior to resize:', error);
					}
				}
				applyRequestedWindowSize(windowInstance, { clampToWorkArea: true });
				try {
					console.log('Reusing window bounds after resize:', windowInstance.getBounds());
				} catch (error) {
					console.warn('Unable to read bounds after resize:', error);
				}
			}

			const hasExplicitX = typeof mergedArgs.x === 'number' && mergedArgs.x !== -1;
			const hasExplicitY = typeof mergedArgs.y === 'number' && mergedArgs.y !== -1;
			if (hasExplicitX || hasExplicitY) {
				const hasValidPosition = hasExplicitX && hasExplicitY;
				if (hasValidPosition) {
					const nextX = Math.floor(mergedArgs.x / factor);
					const nextY = Math.floor(mergedArgs.y / factor);
					windowInstance.setPosition(nextX, nextY);
				} else {
					const currentPosition = windowInstance.getPosition();
					const nextX = hasExplicitX ? Math.floor(mergedArgs.x / factor) : currentPosition[0];
					const nextY = hasExplicitY ? Math.floor(mergedArgs.y / factor) : currentPosition[1];
					windowInstance.setPosition(nextX, nextY);
				}
			}

		if (typeof mergedArgs.pin === 'boolean') {
			if (mergedArgs.pin) {
				if (process.platform === 'darwin') {
					windowInstance.setAlwaysOnTop(true, 'floating', 1);
				} else {
					windowInstance.setAlwaysOnTop(true, 'level');
				}
				windowInstance.setVisibleOnAllWorkspaces(true);
			} else {
				windowInstance.setAlwaysOnTop(false);
				windowInstance.setVisibleOnAllWorkspaces(false);
			}
		}

	if (typeof mergedArgs.fullscreen === 'boolean') {
		const currentlyFullScreen = typeof windowInstance.isFullScreen === 'function' ? windowInstance.isFullScreen() : false;
		if (mergedArgs.fullscreen !== currentlyFullScreen) {
			windowInstance.full = mergedArgs.fullscreen;
			windowInstance.setFullScreen(mergedArgs.fullscreen);
		} else {
			windowInstance.full = mergedArgs.fullscreen;
		}
	}

		const shouldMinimize = mergedArgs.min === true;
		if (shouldMinimize) {
			windowInstance.minimize();
		} else {
			ensureWindowVisible(windowInstance, { forceShow: true, focus: true });
		}
		try {
			const finalBounds = windowInstance.getBounds();
			const normalBounds = typeof windowInstance.getNormalBounds === 'function' ? windowInstance.getNormalBounds() : null;
			console.log('applyArgsToExistingWindow: final state', {
				isVisible: windowInstance.isVisible(),
				isMinimized: windowInstance.isMinimized(),
				bounds: finalBounds,
				normalBounds
			});
		} catch (stateError) {
			console.warn('applyArgsToExistingWindow: unable to capture final state:', stateError);
		}
	} catch (error) {
		console.error('Failed to apply arguments to existing window:', error);
		return false;
	}

	return true;
}

function isProcessElevated() {
	if (typeof cachedElevationState === 'boolean') {
		return cachedElevationState;
	}
	if (process.platform === 'win32') {
		try {
			execSync('fltmc', { stdio: 'ignore' });
			cachedElevationState = true;
		} catch (error) {
			if (error && error.code === 'ENOENT') {
				console.warn('Elevation check failed: fltmc command not available; assuming process is not elevated.');
			}
			cachedElevationState = false;
		}
		return cachedElevationState;
	}
	if (typeof process.getuid === 'function') {
		cachedElevationState = process.getuid() === 0;
		return cachedElevationState;
	}
	cachedElevationState = false;
	return cachedElevationState;
}

process.on('uncaughtException', function (error) {
	console.error("uncaughtException");
    console.error(error);
});

unhandled();

try {
  console.log('Loading window-audio-capture module...');
  windowAudioCapture = require('./native-modules/window-audio-capture');
  console.log('Module loaded successfully');
  
  // Test if the module methods exist and log them
  const methods = Object.keys(windowAudioCapture);
  console.log('Module methods:', methods);
  
  // Check if we have the expected API structure
  if (!windowAudioCapture.getWindowList && windowAudioCapture.captureInstance) {
    console.log('Module has captureInstance structure');
  }
  
  // Test the getWindowList function
  try {
    let windows;
    if (windowAudioCapture.getWindowList) {
      windows = windowAudioCapture.getWindowList();
    } else if (windowAudioCapture.captureInstance && windowAudioCapture.captureInstance.getWindowList) {
      windows = windowAudioCapture.captureInstance.getWindowList();
    }
    
    console.log('Windows list type:', typeof windows);
    console.log('Is array:', Array.isArray(windows));
    console.log('Windows length:', windows ? (Array.isArray(windows) ? windows.length : 'not an array') : 'undefined');
    console.log('First window:', windows && windows.length > 0 ? windows[0] : 'none');
  } catch (testError) {
    console.error('Error testing getWindowList:', testError);
  }
} catch (err) {
  console.error('Error loading window-audio-capture module:', err);
}

if (windowAudioCapture && typeof windowAudioCapture === 'object') {
  try {
    if (typeof windowAudioCapture.getWindowList === 'function' ||
        (windowAudioCapture.captureInstance && typeof windowAudioCapture.captureInstance.getWindowList === 'function')) {
      windowAudioCaptureAvailable = true;
    } else if (typeof windowAudioCapture.startStreamCapture === 'function') {
      windowAudioCaptureAvailable = true;
    }
  } catch (availabilityError) {
    console.warn('Failed to evaluate window audio availability:', availabilityError);
    windowAudioCaptureAvailable = false;
  }
}

var ver = app.getVersion();
const DEFAULT_URL = `https://vdo.ninja/electron?version=${ver}`;
const GAME_CAPTURE_SHELL_URL = pathToFileURL(path.join(__dirname, 'gamecapture.html')).href;
const DEFAULT_MODE = 'game';
const APP_AUDIO_PARAM_KEYS = ['appaudio', 'appAudio', 'appAudioTarget'];
const STREAM_ID_MIN_WORDS = 1;
const STREAM_ID_MAX_WORDS = 3;
const SHARE_PROFILE_FILENAME = 'gamecapture-profile.json';
const SHARE_PROFILE_VERSION = 1;
const STREAM_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const STREAM_ID_ALPHABET_WITH_UNDERSCORE = `${STREAM_ID_ALPHABET}_`;
const DEFAULT_VDO_BASE_URL = 'https://dev.versus.cam/gamecapture/';
const DEFAULT_SHARE_PROFILE = {
  version: SHARE_PROFILE_VERSION,
  streamIdMode: 'words',
  streamIdWordCount: 2,
  streamId: null,
  streamIdGeneratedAt: null,
  roomCode: '',
  roomPassword: '',
  advanced: {
    baseHost: DEFAULT_VDO_BASE_URL,
    qualityPreset: 'versus-hq',
    publishBitrateKbps: 9000,
    viewBitrateKbps: 8500,
    audioBitrateKbps: 192,
    codec: 'h264',
    stereo: true,
    preferWhipRelay: false,
    hideCursor: true
  }
};
const shareProfileCache = {
  profile: null
};

function createYargs(){
  var argv = Yargs.usage('Usage: $0 -w=num -h=num -u="string" -p')
  .example(
    '$0 -w=1280 -h=720 -u="https://vdo.ninja/?view=xxxx"',
    "Loads the stream with ID xxxx into a window sized 1280x720"
  )
  .option("w", {
    alias: "width",
    describe: "The width of the window in pixel.",
    type: "number",
    nargs: 1,
	default: 1856
  })
  .option("h", {
    alias: "height",
    describe: "The height of the window in pixels.",
    type: "number",
    nargs: 1,
	default: 1728
  })
  .option("monitor", {
	  alias: "m",
	  describe: "Monitor index to open on (0-based index)",
	  type: "number",
	  default: 0
	})
  .option("u", {
    alias: "url",
    describe: "The URL of the window to load.",
	default: DEFAULT_URL,
    type: "string"

  })
  .option("mode", {
    describe: "Launch mode (game|classic)",
    type: "string",
    nargs: 1,
	default: DEFAULT_MODE
  })
  .option("t", {
    alias: "title",
    describe: "The default Title for the app Window",
    type: "string",
	default: null
  })
  .option("p", {
    alias: "pin",
    describe: "Toggle always on top",
    type: "boolean",
	default: process.platform == 'darwin'
  })
  .option("a", {
    alias: "hwa",
    describe: "Enable Hardware Acceleration",
    type: "boolean",
	default: true
  })
  .option("x", {
	alias: "x",
    describe: "Window X position",
    type: "number",
	nargs: 1,
	default: -1
  })
  .option("y", {
	alias: "y",
    describe: "Window Y position",
    type: "number",
	nargs: 1,
	default: -1
  })
  .option("node", {
	alias: "n",
    describe: "Enables node-integration, allowing for screen capture, global hotkeys, prompts, and more.",
    type: "boolean",
	default: true
  })
  .option("minimized", {
	alias: "min",
    describe: "Starts the window minimized",
    type: "boolean",
	default: false
  })
  .option("fullscreen", {
    alias: "f",
    describe: "Enables full-screen mode for the first window on its load.",
    type: "boolean",
    default: false
  })
  .option("multiinstance", {
    alias: ["standalone"],
    describe: "Opt-out of the single-instance lock so this run stays isolated from other launches.",
    type: "boolean",
    default: false
  })
  .option("unclickable", {
    alias: "uc",
    describe: "The page will pass thru any mouse clicks or other mouse events",
    type: "boolean",
    default: false
  })
  .option("js", {
	  alias: "js",
	  describe: "Have local JavaScript script be auto-loaded into every page",
	  type: "string",
	  default: null
	})
  .option("savefolder", {
    alias: "sf",
    describe: "Where to save a file on disk",
    type: "string",
    default: null
  })
   .option("mediafoundation", {
    alias: "mf",
    describe: "Enable media foundation video capture",
    type: "string",
    default: null
  })
  .option("disablemediafoundation", {
    alias: "dmf",
    describe: "Disable media foundation video capture; helps capture some webcams",
    type: "string",
    default: null
  })
  .option("css", {
    alias: "css",
    describe: "Have local CSS script be auto-loaded into every page",
    type: "string",
    default: null
  })
  .option("chroma", {
    alias: "color",
    describe: "Set background CSS to target hex color; FFF or 0000 are examples.",
    type: "string",
	default: null
  })
  .option("hidecursor", {
    alias: "hc",
    describe: "Hide the mouse pointer / cursor",
    type: "boolean",
	default: null
  })
  .option("usewgc", {
    alias: "wgc",
    describe: "Allow Windows Graphics Capture backend. Disable for better compatibility when running elevated.",
    type: "boolean"
  })
  .option("d3d12Encoder", {
    alias: "d3d12enc",
    describe: "Enable D3D12 hardware video encoders on Windows when supported.",
    type: "boolean",
    default: false
  })
  .option("vaapiEncoder", {
    alias: "vaapienc",
    describe: "Enable VA-API hardware video encoders on Linux when supported.",
    type: "boolean",
    default: true
  })
  .option("ignoreGpuBlocklist", {
    alias: "ignoregpub",
    describe: "Ignore Chromium's GPU blocklist (forces hardware acceleration even when blocklisted).",
    type: "boolean",
    default: false
  })
  .option("respectGpuBlocklist", {
    alias: "respectgpub",
    describe: "[Deprecated] Use --ignoregpub to disable the blocklist. Passing false here is equivalent to --ignoregpub.",
    type: "boolean"
  })
  .option("encoderMode", {
    alias: "encmode",
    describe: "Default encoder mode for WebCodecs/WebRTC in the renderer (hardware|software|auto).",
    type: "string",
    default: "hardware"
  })
  .option("webrtcPreferredCodec", {
    alias: "webrtcCodec",
    describe: "Preferred outbound WebRTC codec to prioritize (auto|h264|vp9|av1).",
    type: "string",
    default: "auto"
  })
  .option("webrtcMaxBitrate", {
    alias: "webrtcBr",
    describe: "Default target max bitrate (in bps) for WebRTC video senders when unspecified.",
    type: "number",
    default: 0
  })
  .option("gpuinfo", {
    alias: "gpudiag",
    describe: "Open a chrome://gpu diagnostics window at startup.",
    type: "boolean",
    default: false
  })
  .option("webrtcH264KeyframeTrial", {
    alias: "h264keytrial",
    describe: "Enable WebRTC H.264 SPS/PPS keyframe field trial workaround.",
    type: "boolean",
    default: false
  })
  .describe("help", "Show help.") // Override --help usage message.
  .wrap(process.stdout.columns); 
  
  return argv.argv;
}

function sanitizeCliToken(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function collectPotentialCliArgs() {
  const aggregated = [];

  const directArgs = Array.isArray(process.argv) ? process.argv.slice(2) : [];
  for (const entry of directArgs) {
    const sanitized = sanitizeCliToken(entry);
    if (typeof sanitized === 'string' && sanitized.length) {
      aggregated.push(sanitized);
    }
  }

  const envRaw = process.env.npm_config_argv;
  if (envRaw) {
    try {
      const parsed = JSON.parse(envRaw);
      const candidateLists = [];
      if (Array.isArray(parsed.original)) {
        candidateLists.push(parsed.original);
      }
      if (Array.isArray(parsed.cooked)) {
        candidateLists.push(parsed.cooked);
      }

      const appendTokens = (sequence) => {
        if (!Array.isArray(sequence)) {
          return;
        }
        let startIndex = sequence.indexOf('--');
        if (startIndex === -1) {
          startIndex = 0;
        } else {
          startIndex += 1;
        }
        for (let i = startIndex; i < sequence.length; i++) {
          const sanitized = sanitizeCliToken(sequence[i]);
          if (typeof sanitized === 'string' && sanitized.length && !aggregated.includes(sanitized)) {
            aggregated.push(sanitized);
          }
        }
      };

      candidateLists.forEach(appendTokens);
    } catch (error) {
      console.warn('Unable to parse npm_config_argv for CLI hydration:', error);
    }
  }

  return aggregated;
}

function hydrateArgsFromRawProcessArgs(args) {
  if (!args || typeof args !== 'object') {
    return args;
  }

  const rawArgs = collectPotentialCliArgs();
  if (!rawArgs.length) {
    return args;
  }

  try {
    console.log('hydrateArgsFromRawProcessArgs.rawArgs', rawArgs);
  } catch (e) {}

  const findIndex = (predicate) => rawArgs.findIndex(predicate);

  const urlKeys = new Set(['--url', '-u']);
  let urlIndex = findIndex((entry) => urlKeys.has(entry));
  let resolvedUrl = null;

  if (urlIndex !== -1) {
    const nextValue = rawArgs[urlIndex + 1];
    if (typeof nextValue === 'string' && !nextValue.startsWith('-')) {
      resolvedUrl = nextValue;
    }
  } else {
    urlIndex = findIndex((entry) => typeof entry === 'string' && entry.toLowerCase().startsWith('--url='));
    if (urlIndex !== -1) {
      resolvedUrl = rawArgs[urlIndex].slice(6);
    }
  }

  if (!resolvedUrl) {
    const httpIndex = findIndex((entry) => typeof entry === 'string' && /^https?:\/\//i.test(entry));
    if (httpIndex !== -1) {
      const collected = [rawArgs[httpIndex]];
      for (let i = httpIndex + 1; i < rawArgs.length; i++) {
        const value = rawArgs[i];
        if (typeof value !== 'string' || value.startsWith('-')) {
          break;
        }
        collected.push(value);
      }
      resolvedUrl = collected.join(' ');
    }
  }

  if (resolvedUrl && typeof resolvedUrl === 'string') {
    const sanitizedUrl = sanitizeCliToken(resolvedUrl);
    if (sanitizedUrl.length) {
      args.url = sanitizedUrl;
      args.u = sanitizedUrl;
      if (Array.isArray(args._)) {
        if (!args._.includes(sanitizedUrl)) {
          args._.unshift(sanitizedUrl);
        }
      } else {
        args._ = [sanitizedUrl];
      }
    }
  }

  const coerceBoolean = (value) => {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (Number.isFinite(value)) {
        if (value === 0) {
          return false;
        }
        if (value === 1) {
          return true;
        }
      }
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed.length) {
        return undefined;
      }
      if (/^(false|0|no|off|disable|disabled)$/i.test(trimmed)) {
        return false;
      }
      if (/^(true|1|yes|on|enable|enabled)$/i.test(trimmed)) {
        return true;
      }
    }
    return undefined;
  };

  let nodeExplicit = false;

  const applyNodeValue = (value) => {
    if (typeof value === 'boolean') {
      args.node = value;
      args.n = value;
      nodeExplicit = true;
    }
  };

  const tryApplyBoolean = (candidate) => {
    const coerced = coerceBoolean(candidate);
    if (typeof coerced === 'boolean') {
      applyNodeValue(coerced);
      return true;
    }
    return false;
  };

  const normalizeToken = (token) => (typeof token === 'string' ? token.trim() : '');

  if (typeof args.node === 'boolean') {
    args.n = args.node;
  } else if (typeof args.n === 'boolean') {
    args.node = args.n;
  }

  for (let i = 0; i < rawArgs.length; i++) {
    const token = normalizeToken(rawArgs[i]);
    if (!token) {
      continue;
    }

    const lower = token.toLowerCase();

    if (lower === '--no-node' || lower === '--disable-node') {
      applyNodeValue(false);
      continue;
    }

    if (token === '--node' || token === '-n') {
      const nextValue = rawArgs[i + 1];
      if (!tryApplyBoolean(nextValue)) {
        applyNodeValue(true);
      } else {
        i += 1;
      }
      continue;
    }

    if (lower.startsWith('--node=')) {
      const value = token.slice('--node='.length);
      if (!tryApplyBoolean(value)) {
        applyNodeValue(true);
      }
      continue;
    }

    if (lower.startsWith('-n=')) {
      const value = token.slice(3);
      if (!tryApplyBoolean(value)) {
        applyNodeValue(true);
      }
      continue;
    }
  }

  if (!nodeExplicit && typeof args.url === 'string') {
    try {
      const parsedUrl = new URL(args.url);
      const nodeParamKeys = ['node', 'nodeintegration', 'nodeIntegration', 'enableNode'];
      for (const key of nodeParamKeys) {
        if (!parsedUrl.searchParams.has(key)) {
          continue;
        }
        const rawValue = parsedUrl.searchParams.get(key);
        if (rawValue === null || rawValue === '') {
          applyNodeValue(true);
        } else if (!tryApplyBoolean(rawValue)) {
          const lowered = rawValue.trim().toLowerCase();
          if (lowered && /^(disable|disabled|off|no)$/i.test(lowered)) {
            applyNodeValue(false);
          } else if (lowered && /^(auto)$/i.test(lowered)) {
            // leave for heuristic step
          } else {
            applyNodeValue(true);
          }
        }
        break;
      }
    } catch (_error) {
      // ignore malformed URLs
    }
  }

  if (!nodeExplicit) {
    let preferNodeIntegration = false;
    if (typeof args.url === 'string') {
      const loweredUrl = args.url.toLowerCase();
      if (loweredUrl.includes('screenshare') || loweredUrl.includes('appaudio')) {
        preferNodeIntegration = true;
      }
    }
    if (preferNodeIntegration) {
      applyNodeValue(true);
    }
  }

  if (typeof args.node !== 'boolean') {
    args.node = false;
  }
  if (typeof args.n !== 'boolean') {
    args.n = args.node;
  }

  args.__nodeExplicit = nodeExplicit;

  return args;
}

var Argv = hydrateArgsFromRawProcessArgs(createYargs());
;

const VALID_ENCODER_MODES = new Set(['hardware', 'software', 'auto']);

function normalizeEncoderModeToken(rawValue) {
  if (typeof rawValue === 'boolean') {
    return rawValue ? 'hardware' : 'software';
  }
  if (typeof rawValue !== 'string') {
    return null;
  }
  const token = rawValue.trim().toLowerCase();
  if (token === 'hardware' || token === 'hw' || token === 'gpu' || token === 'prefer-hardware') {
    return 'hardware';
  }
  if (token === 'software' || token === 'sw' || token === 'cpu' || token === 'prefer-software') {
    return 'software';
  }
  if (token === 'auto' || token === 'automatic') {
    return 'auto';
  }
  if (token === 'default' || token === 'reset') {
    return 'default';
  }
  return null;
}

function resolveEncoderModeOption(rawValue) {
  const normalized = normalizeEncoderModeToken(rawValue);
  if (normalized && VALID_ENCODER_MODES.has(normalized)) {
    return normalized;
  }
  return 'hardware';
}

function normalizeEncoderModeOverride(rawValue) {
  const normalized = normalizeEncoderModeToken(rawValue);
  if (!normalized || normalized === 'default') {
    return null;
  }
  if (VALID_ENCODER_MODES.has(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeCodecPreference(rawValue) {
  if (typeof rawValue !== 'string') {
    return 'auto';
  }
  const token = rawValue.trim().toLowerCase();
  if (token === 'h264' || token === 'avc' || token === 'avc1' || token === 'h.264') {
    return 'h264';
  }
  if (token === 'vp9' || token === 'vp09') {
    return 'vp9';
  }
  if (token === 'av1' || token === 'av01') {
    return 'av1';
  }
  return 'auto';
}

Argv.encoderMode = resolveEncoderModeOption(Argv.encoderMode);
Argv.webrtcPreferredCodec = normalizeCodecPreference(Argv.webrtcPreferredCodec);
const parsedBitrate = Number(Argv.webrtcMaxBitrate);
Argv.webrtcMaxBitrate = Number.isFinite(parsedBitrate) && parsedBitrate > 0 ? Math.floor(parsedBitrate) : 0;

const legacyRespectFlagProvided = typeof Argv.respectGpuBlocklist === 'boolean';
if (legacyRespectFlagProvided) {
	console.warn('The --respectgpub/--respectGpuBlocklist flag is deprecated; use --ignoregpub instead.');
	Argv.ignoreGpuBlocklist = Argv.respectGpuBlocklist === false;
} else {
	Argv.ignoreGpuBlocklist = Argv.ignoreGpuBlocklist === true;
}
delete Argv.respectGpuBlocklist;
delete Argv.respectgpub;
delete Argv.ignoregpub;

const allowMultipleInstances = Argv.multiinstance === true || Argv.standalone === true;

const hardwareEncodingState = {
	encoderModeOverride: null
};

ipcMain.handle('hardware-encoding:get-preferences', () => {
	const effectiveMode = hardwareEncodingState.encoderModeOverride || Argv.encoderMode;
	return {
		defaultMode: Argv.encoderMode,
		preferredMode: effectiveMode,
		codecPreference: Argv.webrtcPreferredCodec,
		maxBitrate: Argv.webrtcMaxBitrate
	};
});

ipcMain.on('hardware-encoding:set-mode', (event, requestedMode) => {
	const normalized = normalizeEncoderModeOverride(requestedMode);
	if (normalized === hardwareEncodingState.encoderModeOverride) {
		return;
	}
	if (!normalized) {
		hardwareEncodingState.encoderModeOverride = null;
	} else {
		hardwareEncodingState.encoderModeOverride = normalized;
	}
	const effectiveMode = hardwareEncodingState.encoderModeOverride || Argv.encoderMode;
	BrowserWindow.getAllWindows().forEach((windowInstance) => {
		try {
			windowInstance.webContents.send('hardware-encoding:mode-updated', effectiveMode);
		} catch (error) {
			console.warn('Failed to broadcast encoder mode update to a window:', error);
		}
	});
	console.log('Hardware encoder mode updated:', {
		requestedMode,
		effectiveMode,
		override: hardwareEncodingState.encoderModeOverride
	});
});

let gpuDiagnosticsWindow = null;

function openGpuDiagnosticsWindow() {
	if (gpuDiagnosticsWindow && !gpuDiagnosticsWindow.isDestroyed()) {
		gpuDiagnosticsWindow.focus();
		try {
			console.log('Reusing GPU diagnostics window bounds:', gpuDiagnosticsWindow.getBounds());
		} catch (error) {
			console.warn('Unable to read GPU diagnostics window bounds:', error);
		}
		return true;
	}
	try {
		gpuDiagnosticsWindow = new BrowserWindow({
			width: 1000,
			height: 720,
			title: 'GPU Diagnostics',
			webPreferences: {
				nodeIntegration: false,
				contextIsolation: true,
				sandbox: false
			}
		});
		gpuDiagnosticsWindow.on('closed', () => {
			gpuDiagnosticsWindow = null;
		});
		gpuDiagnosticsWindow.loadURL('chrome://gpu');
		return true;
	} catch (error) {
		console.error('Failed to open GPU diagnostics window:', error);
		gpuDiagnosticsWindow = null;
		return false;
	}
}

ipcMain.handle('hardware-encoding:open-gpu-diagnostics', () => {
	return openGpuDiagnosticsWindow();
});

if (Argv.help) {
  Argv.showHelp();
  process.exit(0); // Exit the script after showing help.
}

if (!allowMultipleInstances) {
	const gotInstanceLock = app.requestSingleInstanceLock(Argv);
	if (!gotInstanceLock) {
		console.log('requestSingleInstanceLock');
		app.exit(0); // ensure the helper instance terminates after handing off args
		return;
	}
}


function parseDeepLink(deepLinkUrl) {
	console.log('Parsing deep link:', deepLinkUrl);
	try {
		const newArgs = { ...Argv };

		deepLinkUrl = deepLinkUrl.replace("electroncapture://", "https://");
		const url = new URL(deepLinkUrl);
		const sanitizedUrl = new URL(url.href);

		console.log('Parsed URL:', {
			pathname: url.pathname,
			search: url.search,
			hash: url.hash
		});

		const assignWithAlias = (key, alias, value) => {
			newArgs[key] = value;
			if (alias) {
				newArgs[alias] = value;
			}
		};

		const parseBooleanValue = (rawValue) => {
			if (rawValue === null) {
				return undefined;
			}
			const trimmed = rawValue.trim();
			if (!trimmed.length) {
				return true;
			}
			if (/^(false|0|no|off|disable|disabled)$/i.test(trimmed)) {
				return false;
			}
			if (/^(true|1|yes|on|enable|enabled)$/i.test(trimmed)) {
				return true;
			}
			return undefined;
		};

		const parseIntegerValue = (rawValue) => {
			if (typeof rawValue !== 'string') {
				return undefined;
			}
			const trimmed = rawValue.trim();
			if (!trimmed.length) {
				return undefined;
			}
			const parsed = Number.parseInt(trimmed, 10);
			return Number.isFinite(parsed) ? parsed : undefined;
		};

		const updateUrlArgs = (href) => {
			assignWithAlias('url', 'u', href);
			newArgs._ = Array.isArray(newArgs._)
				? [href, ...newArgs._.filter((entry) => entry !== href)]
				: [href];
		};

	const params = new URLSearchParams(url.search);

	const normalizedMode = normalizeModeValue(params.get('mode'));
	const baseModeFromArgs = normalizeModeValue(newArgs.mode);
	if (normalizedMode) {
		newArgs.mode = normalizedMode;
		sanitizedUrl.searchParams.delete('mode');
	} else if (baseModeFromArgs && newArgs.mode !== baseModeFromArgs) {
		newArgs.mode = baseModeFromArgs;
	}

	const resolvedMode = normalizedMode || baseModeFromArgs || normalizeModeValue(DEFAULT_MODE) || DEFAULT_MODE;
	const shouldStripCaptureParams = resolvedMode !== 'classic';

	const slotParamKey = ['slotId', 'slot'].find((key) => params.has(key));
	if (slotParamKey) {
		const slotValue = params.get(slotParamKey);
		if (slotValue && slotValue.trim().length) {
			newArgs.slotId = slotValue.trim();
		}
		if (shouldStripCaptureParams) {
			sanitizedUrl.searchParams.delete(slotParamKey);
		}
	}

	const presetValue = params.get('preset');
	if (presetValue && presetValue.trim().length) {
		newArgs.preset = presetValue.trim();
		if (shouldStripCaptureParams) {
			sanitizedUrl.searchParams.delete('preset');
		}
	}

	const cursorValue = params.get('cursor');
	if (cursorValue && cursorValue.trim().length) {
		newArgs.cursor = cursorValue.trim();
		if (shouldStripCaptureParams) {
			sanitizedUrl.searchParams.delete('cursor');
		}
	}

	if (params.has('whipout')) {
		const parsedWhipout = parseBooleanValue(params.get('whipout'));
		if (typeof parsedWhipout === 'boolean') {
			newArgs.whipout = parsedWhipout;
		}
		if (shouldStripCaptureParams) {
			sanitizedUrl.searchParams.delete('whipout');
		}
	}

	for (const key of APP_AUDIO_PARAM_KEYS) {
		if (params.has(key)) {
			const rawAppAudio = params.get(key);
			if (rawAppAudio && rawAppAudio.trim().length) {
				newArgs.appaudio = rawAppAudio.trim();
			}
			if (shouldStripCaptureParams) {
				sanitizedUrl.searchParams.delete(key);
			}
			break;
		}
	}

		const width = parseIntegerValue(params.get('w'));
		if (typeof width === 'number') {
			assignWithAlias('width', 'w', width);
			sanitizedUrl.searchParams.delete('w');
		}
		const height = parseIntegerValue(params.get('h'));
		if (typeof height === 'number') {
			assignWithAlias('height', 'h', height);
			sanitizedUrl.searchParams.delete('h');
		}
		const xPos = parseIntegerValue(params.get('x'));
		if (typeof xPos === 'number') {
			assignWithAlias('x', 'x', xPos);
			sanitizedUrl.searchParams.delete('x');
		}
		const yPos = parseIntegerValue(params.get('y'));
		if (typeof yPos === 'number') {
			assignWithAlias('y', 'y', yPos);
			sanitizedUrl.searchParams.delete('y');
		}

		if (params.has('title')) {
			assignWithAlias('title', 't', params.get('title'));
			sanitizedUrl.searchParams.delete('title');
		}

		const windowNameKey = ['windowName', 'window'].find((key) => params.has(key));
		if (windowNameKey) {
			const normalizedName = normalizeWindowName(params.get(windowNameKey));
			if (normalizedName) {
				newArgs.windowName = normalizedName;
				sanitizedUrl.searchParams.delete(windowNameKey);
			}
		}

		[
			{ key: 'pin', target: 'pin', alias: 'p' },
			{ key: 'full', target: 'fullscreen', alias: 'f' },
			{ key: 'min', target: 'minimized', alias: 'min' }
		].forEach(({ key, target, alias }) => {
			if (!params.has(key)) {
				return;
			}
			const parsed = parseBooleanValue(params.get(key));
			if (typeof parsed === 'boolean') {
				assignWithAlias(target, alias, parsed);
				sanitizedUrl.searchParams.delete(key);
			}
		});

		const encoderKey = ['encmode', 'encoderMode'].find((key) => params.has(key));
		if (encoderKey) {
			const rawMode = params.get(encoderKey);
			if (rawMode !== null && rawMode.trim().length) {
				assignWithAlias('encoderMode', 'encmode', resolveEncoderModeOption(rawMode));
				sanitizedUrl.searchParams.delete(encoderKey);
			}
		}

		const codecKey = ['webrtcCodec', 'webrtcPreferredCodec'].find((key) => params.has(key));
		if (codecKey) {
			const rawCodec = params.get(codecKey);
			if (rawCodec !== null && rawCodec.trim().length) {
				assignWithAlias('webrtcPreferredCodec', 'webrtcCodec', normalizeCodecPreference(rawCodec));
				sanitizedUrl.searchParams.delete(codecKey);
			}
		}

		const bitrateKey = ['webrtcBr', 'webrtcMaxBitrate'].find((key) => params.has(key));
		if (bitrateKey) {
			const rawBitrate = params.get(bitrateKey);
			if (rawBitrate !== null) {
				const trimmed = rawBitrate.trim();
				if (!trimmed.length) {
					assignWithAlias('webrtcMaxBitrate', 'webrtcBr', 0);
				} else {
					const parsedBitrate = Number(trimmed);
					if (Number.isFinite(parsedBitrate) && parsedBitrate >= 0) {
						const normalizedBitrate = parsedBitrate > 0 ? Math.floor(parsedBitrate) : 0;
						assignWithAlias('webrtcMaxBitrate', 'webrtcBr', normalizedBitrate);
					}
				}
				sanitizedUrl.searchParams.delete(bitrateKey);
			}
		}

			const booleanParamMappings = [
				{ keys: ['d3d12enc', 'd3d12Encoder'], target: 'd3d12Encoder', alias: 'd3d12enc' },
				{ keys: ['vaapienc', 'vaapiEncoder'], target: 'vaapiEncoder', alias: 'vaapienc' },
				{ keys: ['ignoregpub', 'ignoreGpuBlocklist'], target: 'ignoreGpuBlocklist', alias: 'ignoregpub' },
				{ keys: ['respectgpub', 'respectGpuBlocklist'], target: 'respectGpuBlocklist', alias: 'respectgpub' },
				{ keys: ['gpuinfo', 'gpudiag'], target: 'gpuinfo', alias: 'gpudiag' },
				{ keys: ['h264keytrial', 'webrtcH264KeyframeTrial'], target: 'webrtcH264KeyframeTrial', alias: 'h264keytrial' },
				{ keys: ['wgc', 'usewgc'], target: 'usewgc', alias: 'wgc' }
			];

		booleanParamMappings.forEach(({ keys, target, alias }) => {
			for (const key of keys) {
				if (!params.has(key)) {
					continue;
				}
				const parsed = parseBooleanValue(params.get(key));
				if (typeof parsed === 'boolean') {
					assignWithAlias(target, alias, parsed);
					sanitizedUrl.searchParams.delete(key);
				}
				return;
			}
		});

		assignWithAlias('encoderMode', 'encmode', resolveEncoderModeOption(newArgs.encoderMode));
		assignWithAlias('webrtcPreferredCodec', 'webrtcCodec', normalizeCodecPreference(newArgs.webrtcPreferredCodec));
		const effectiveBitrate = Number(newArgs.webrtcMaxBitrate);
		const sanitizedBitrate = Number.isFinite(effectiveBitrate) && effectiveBitrate > 0 ? Math.floor(effectiveBitrate) : 0;
		assignWithAlias('webrtcMaxBitrate', 'webrtcBr', sanitizedBitrate);

		if (typeof newArgs.__originalUrl !== 'string' || !newArgs.__originalUrl.length) {
			newArgs.__originalUrl = sanitizedUrl.href;
		}

		updateUrlArgs(sanitizedUrl.href);

		console.log('Parsed deep link args:', newArgs);
		return newArgs;
	} catch (error) {
		console.error('Error parsing deep link URL:', error);
		return null;
	}
}

function registerProtocolHandling() {
    // Check if we're already the default protocol handler
    if (process.defaultApp) {
        if (process.argv.length >= 2) {
            app.setAsDefaultProtocolClient('electroncapture', process.execPath, [path.resolve(process.argv[1])])
        }
    } else {
        app.setAsDefaultProtocolClient('electroncapture');
    }

    // Handle the case where the app is not the default handler
    if (!app.isDefaultProtocolClient('electroncapture')) {
        try {
            app.setAsDefaultProtocolClient('electroncapture');
        } catch (error) {
            console.error('Failed to register protocol handler:', error);
        }
    }
}

// Handle deep linking on Windows
if (process.platform === 'win32') {
  const deepLinkUrl = process.argv.find(arg => arg.startsWith('electroncapture://'));
  if (deepLinkUrl) {
    console.log('Found deep link in initial launch:', deepLinkUrl);
    const args = parseDeepLink(deepLinkUrl);
    if (args && args.url) {
        Argv = args; // Update initial arguments if valid
    }
  }
}
// Register protocol client
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('electroncapture', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('electroncapture');
}


function getDirectories(path) {
  return fs.readdirSync(path).filter(function (file) {
    return fs.statSync(path+'/'+file).isDirectory();
  });
}
if (Argv.title){
	app.setAppUserModelId(Argv.title);
} else {
	app.setAppUserModelId("ele.cap");
}


if (!(Argv.hwa)){
	app.disableHardwareAcceleration();
	console.log("HWA DISABLED");
}

const enableFeatureSet = new Set(['WebAssemblySimd', 'PlatformHEVCEncoderSupport', 'WebRTCHideCursorFromCapturer']);
const disableFeatureSet = new Set();

if (!(Argv.mf)){
	enableFeatureSet.add('MediaFoundationVideoCapture');
	//app.commandLine.appendSwitch('force-directshow')
	//console.log("Media Foundations video cap ENABLED");
	// --force-directshow
}
if (!(Argv.dmf)){
	disableFeatureSet.add('MediaFoundationVideoCapture');
	//app.commandLine.appendSwitch('force-directshow')
	//console.log("Media Foundations video cap ENABLED");
	// --force-directshow
}

if (process.platform === 'win32') {
	const wgcValue = typeof Argv.usewgc !== 'undefined' ? Argv.usewgc : Argv.wgc;
	const wgcOptionProvided = typeof wgcValue !== 'undefined';
	const preferWgc = wgcValue === true;
	const disableWgcViaCli = wgcOptionProvided && wgcValue === false;
	let elevatedForCapture = false;
	if (!disableWgcViaCli && !preferWgc) {
		try {
			elevatedForCapture = isProcessElevated();
		} catch (error) {
			console.warn('Unable to determine elevation state; assuming not elevated for WGC decisions.', error);
		}
	}
	const shouldDisableWgc = disableWgcViaCli || (!preferWgc && elevatedForCapture);
	if (shouldDisableWgc) {
		disableFeatureSet.add('WinUseBrowserMediaSource');
		if (!disableWgcViaCli && elevatedForCapture) {
			console.log('Windows Graphics Capture disabled automatically for elevated session. Launch with --usewgc to override.');
		}
	}
}

if (process.platform === 'win32' && Argv.d3d12Encoder === true) {
    enableFeatureSet.add('D3D12VideoEncodeAccelerator');
} else if (process.platform === 'win32') {
    console.log('D3D12 video encode accelerator disabled (enable with --d3d12enc).');
}

if (process.platform === 'linux' && Argv.vaapiEncoder !== false) {
	enableFeatureSet.add('VaapiVideoEncoder');
}

if (enableFeatureSet.size > 0) {
	const featureList = Array.from(enableFeatureSet).join(',');
	app.commandLine.appendSwitch('enable-features', featureList);
	console.log('Enabling Chromium features:', featureList);
}

if (disableFeatureSet.size > 0) {
	app.commandLine.appendSwitch('disable-features', Array.from(disableFeatureSet).join(','));
	if (disableFeatureSet.has('WinUseBrowserMediaSource')) {
		console.log('Windows Graphics Capture disabled (override with --wgc to re-enable).');
	}
}

if (Argv.ignoreGpuBlocklist) {
	app.commandLine.appendSwitch('ignore-gpu-blocklist');
	console.log('Chromium GPU blocklist will be ignored for this session.');
}
if (Argv.webrtcH264KeyframeTrial) {
	app.commandLine.appendSwitch('force-fieldtrials', 'WebRTC-H264-SpsPpsIdrIsH264Keyframe/Enabled/');
	console.log('WebRTC H264 SPS/PPS keyframe field trial enabled.');
}
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('max-web-media-player-count', '5000');
app.commandLine.appendSwitch('disable-site-isolation-trials');
app.commandLine.appendSwitch('ignore-certificate-errors');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('ignore-certificate-errors-spki-list');
app.commandLine.appendSwitch('unsafely-treat-insecure-origin-as-secure', 'http://insecure.vdo.ninja,http://insecure.rtc.ninja,http://whip.vdo.ninja,https://whip.vdo.ninja,http://whep.vdo.ninja,https://whep.vdo.ninja,http://insecure.versus.cam,http://127.0.0.1,https://vdo.ninja,https://versus.cam,https://rtc.ninja');


var counter=0;
var forcingAspectRatio = false;

var extensions = [];
try {
	var dir = false;
	if (process.platform == 'win32'){
		dir = process.env.APPDATA.replace("Roaming","")+"\\Local\\Google\\Chrome\\User Data\\Default\\Extensions";
		if (dir){
			//dir = dir.replace("Roaming","");
			var ttt = getDirectories(dir);
			ttt.forEach(d=>{
				try {
					var ddd = getDirectories(dir+"\\"+d);
					var fd = fs.readFileSync(dir+"\\"+d+"\\"+ddd[0]+"\\manifest.json", 'utf8');
					var json = JSON.parse(fd);
					
					if (json.name.startsWith("_")){
						return;			
					}
					
					extensions.push({
						"name": json.name,
						"location": dir+"\\"+d+"\\"+ddd[0]
					});
				} catch(e){}
			});
		}
	} else if (process.platform == 'darwin'){
		dir = process.env.HOME + "/Library/Application Support/Google/Chrome/Default/Extensions";
		console.log(dir);
		if (dir){
		//dir = dir.replace("Roaming","");
			var ttt = getDirectories(dir);
			ttt.forEach(d=>{
				try {
					var ddd = getDirectories(dir+"/"+d);
					var fd = fs.readFileSync(dir+"."+d+"/"+ddd[0]+"/manifest.json", 'utf8');
					var json = JSON.parse(fd);
					
					if (json.name.startsWith("_")){
						return;			
					}
					
					extensions.push({
						"name": json.name,
						"location": dir+"/"+d+"/"+ddd[0]
					});
				} catch(e){console.error(e);}
			});
		}
	}
	
} catch(e){console.error(e);}

function sleep(ms) {
  return new Promise((resolve) => {
	setTimeout(resolve, ms);
  });
}

const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

function formatURL(inputURL) {
  if (!inputURL.startsWith("http://") && !inputURL.startsWith("https://") && !inputURL.startsWith("file://")) {
    return "https://" + inputURL;
  }
  return inputURL;
}


function normalizeModeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const token = String(value).trim().toLowerCase();
  if (!token.length) {
    return null;
  }
  if (['game', 'gamecapture', 'versus', 'esports'].includes(token)) {
    return 'game';
  }
  if (['classic', 'default', 'standard', 'browser'].includes(token)) {
    return 'classic';
  }
  return token;
}

function sanitizeInviteUrl(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }
  let trimmed = rawValue.trim();
  if (!trimmed.length) {
    return null;
  }
  if (trimmed.startsWith('electroncapture://')) {
    trimmed = trimmed.replace(/^electroncapture:\/\//i, 'https://');
  }
  if (!/^https?:/i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  return trimmed;
}

function isDefaultVdoElectronUrl(targetUrl) {
  if (typeof targetUrl !== 'string' || !targetUrl.trim().length) {
    return false;
  }
  try {
    const normalizedTarget = targetUrl.trim();
    const defaultNormalized = DEFAULT_URL.trim();
    if (normalizedTarget.toLowerCase() === defaultNormalized.toLowerCase()) {
      return true;
    }
    const parsed = new URL(normalizedTarget);
    const host = (parsed.hostname || '').toLowerCase();
    const path = (parsed.pathname || '').toLowerCase();
    if (!host.includes('vdo.ninja') || !path.includes('electron')) {
      return false;
    }
    const search = (parsed.search || '').replace(/^\?/, '').trim();
    // Treat as default only when no additional query params beyond version exist.
    if (!search.length) {
      return true;
    }
    const params = new URLSearchParams(parsed.search);
    const keys = Array.from(params.keys());
    if (keys.length === 1 && keys[0] === 'version') {
      return true;
    }
    return false;
  } catch (error) {
    console.warn('Failed to evaluate default vdo electron URL:', error);
    return false;
  }
}

function shouldTreatUrlAsInviteCandidate(targetUrl) {
  if (typeof targetUrl !== 'string') {
    return false;
  }
  if (!/^https?:/i.test(targetUrl)) {
    return false;
  }
  return !isDefaultVdoElectronUrl(targetUrl);
}

function ensureGameCaptureState(windowInstance) {
  if (!windowInstance || typeof windowInstance !== 'object') {
    return null;
  }
  if (!windowInstance.__gameCaptureState) {
    windowInstance.__gameCaptureState = {
      mode: null,
      landingUrl: GAME_CAPTURE_SHELL_URL,
      pendingInviteUrl: null,
      activeInviteUrl: null,
      lastInviteUrl: null,
      slotId: null,
      preset: null,
      cursorPreference: null,
      appAudioTarget: null,
      transportPreference: null,
      lastError: null,
      shareProfile: null
    };
  }
  return windowInstance.__gameCaptureState;
}

function buildGameCaptureContext(windowInstance) {
  const state = ensureGameCaptureState(windowInstance);
  if (!state) {
    return null;
  }
  const meta = buildWindowMetaSnapshot(windowInstance);
  return {
    mode: state.mode,
    landingUrl: state.landingUrl,
    pendingInviteUrl: state.pendingInviteUrl,
    activeInviteUrl: state.activeInviteUrl,
    lastInviteUrl: state.lastInviteUrl,
    slotId: state.slotId,
    preset: state.preset,
    cursorPreference: state.cursorPreference,
    appAudioTarget: state.appAudioTarget,
    transportPreference: state.transportPreference,
    lastError: state.lastError,
    shareProfile: state.shareProfile,
    windowId: windowInstance ? windowInstance.id : null,
    windowMeta: meta
  };
}

function updateGameCaptureState(windowInstance, updates = {}) {
  const state = ensureGameCaptureState(windowInstance);
  if (!state) {
    return null;
  }
  Object.assign(state, updates);
  return buildGameCaptureContext(windowInstance);
}

function pushGameCaptureUpdate(windowInstance, reason = 'state-changed') {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return;
  }
  const payload = {
    reason,
    state: buildGameCaptureContext(windowInstance)
  };
  try {
    windowInstance.webContents.send('gamecapture:update', payload);
  } catch (error) {
    console.warn('Unable to push gamecapture update to renderer:', error);
  }
}

function formatGameCaptureDebugPayload(payload) {
  if (payload === null || payload === undefined) {
    return '';
  }
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    return JSON.stringify(payload);
  } catch (error) {
    return String(payload);
  }
}

function getPrimaryGameCaptureWindow(options = {}) {
  const windows = BrowserWindow.getAllWindows().filter((win) => win && !win.isDestroyed());
  if (!windows.length) {
    return null;
  }
  const prioritized = windows.find((win) => {
    const state = win.__gameCaptureState;
    return state && state.mode === 'game';
  });
  if (options && options.requireGameMode) {
    return prioritized || null;
  }
  return prioritized || windows[0];
}

function isWindowDisplayingGameShell(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return false;
  }
  try {
    const currentUrl = windowInstance.webContents.getURL() || '';
    if (!currentUrl || !GAME_CAPTURE_SHELL_URL) {
      return false;
    }
    return currentUrl.startsWith(GAME_CAPTURE_SHELL_URL);
  } catch (error) {
    return false;
  }
}

function applyInviteToWindow(windowInstance, invitePayload = {}) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return false;
  }
  const normalizedUrl = sanitizeInviteUrl(invitePayload.inviteUrl);
  if (!normalizedUrl) {
    return false;
  }
  const updates = {
    pendingInviteUrl: normalizedUrl,
    lastInviteUrl: normalizedUrl,
    activeInviteUrl: null,
    lastError: null
  };
  if (invitePayload.slotId) {
    updates.slotId = invitePayload.slotId;
  }
  if (invitePayload.preset) {
    updates.preset = invitePayload.preset;
  }
  if (invitePayload.cursorPreference) {
    updates.cursorPreference = invitePayload.cursorPreference;
  }
  if (invitePayload.appAudioTarget) {
    updates.appAudioTarget = invitePayload.appAudioTarget;
  }
  if (typeof invitePayload.transportPreference !== 'undefined') {
    updates.transportPreference = invitePayload.transportPreference;
  }
  updateGameCaptureState(windowInstance, updates);
  pushGameCaptureUpdate(windowInstance, invitePayload.reason || 'incoming-invite');
  if (windowInstance.isMinimized && windowInstance.isMinimized()) {
    try {
      windowInstance.restore();
    } catch (error) {
      console.warn('Failed to restore window after invite:', error);
    }
  }
  try {
    windowInstance.focus();
  } catch (error) {
    console.warn('Failed to focus window after invite:', error);
  }
  return true;
}

function launchInviteInWindow(windowInstance, inviteUrl, metadata = {}) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return { success: false, error: 'missing-window' };
  }
  const normalizedUrl = sanitizeInviteUrl(inviteUrl);
  if (!normalizedUrl) {
    return { success: false, error: 'invalid-url' };
  }
  const state = ensureGameCaptureState(windowInstance) || {};
  const decorationOptions = {
    slotId: metadata.slotId || state.slotId,
    preset: metadata.preset || state.preset,
    cursorPreference: metadata.cursorPreference || state.cursorPreference,
    appAudioTarget: metadata.appAudioTarget || state.appAudioTarget,
    transportPreference: typeof metadata.transportPreference !== 'undefined'
      ? metadata.transportPreference
      : state.transportPreference
  };
  const targetUrl = state.mode === 'game'
    ? decorateInviteForGameMode(normalizedUrl, decorationOptions)
    : normalizedUrl;
  updateGameCaptureState(windowInstance, {
    pendingInviteUrl: null,
    activeInviteUrl: targetUrl,
    lastInviteUrl: normalizedUrl,
    lastError: null
  });
  if (metadata.slotId) {
    updateGameCaptureState(windowInstance, { slotId: metadata.slotId });
  }
  if (metadata.preset) {
    updateGameCaptureState(windowInstance, { preset: metadata.preset });
  }
  if (metadata.cursorPreference) {
    updateGameCaptureState(windowInstance, { cursorPreference: metadata.cursorPreference });
  }
  if (metadata.appAudioTarget) {
    updateGameCaptureState(windowInstance, { appAudioTarget: metadata.appAudioTarget });
  }
  if (typeof metadata.transportPreference !== 'undefined') {
    updateGameCaptureState(windowInstance, { transportPreference: metadata.transportPreference });
  }
  try {
    windowInstance.args = windowInstance.args || {};
    windowInstance.args.url = targetUrl;
    windowInstance.loadURL(targetUrl);
    pushGameCaptureUpdate(windowInstance, 'invite-launched');
    return { success: true, url: targetUrl };
  } catch (error) {
    updateGameCaptureState(windowInstance, { lastError: error.message });
    pushGameCaptureUpdate(windowInstance, 'launch-error');
    return { success: false, error: error.message };
  }
}

function returnWindowToShell(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return { success: false, error: 'missing-window' };
  }
  try {
    windowInstance.args = windowInstance.args || {};
    windowInstance.args.url = GAME_CAPTURE_SHELL_URL;
    updateGameCaptureState(windowInstance, {
      activeInviteUrl: null,
      lastError: null
    });
    windowInstance.loadURL(GAME_CAPTURE_SHELL_URL);
    pushGameCaptureUpdate(windowInstance, 'returned-to-shell');
    return { success: true, url: GAME_CAPTURE_SHELL_URL };
  } catch (error) {
    updateGameCaptureState(windowInstance, { lastError: error.message });
    return { success: false, error: error.message };
  }
}

function decorateInviteForGameMode(baseUrl, metadata = {}) {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return baseUrl;
  }
  try {
    const parsed = new URL(baseUrl);
    parsed.searchParams.set('gamecapture', '1');
    parsed.searchParams.set('gc_mode', 'game');
    if (metadata.slotId) {
      parsed.searchParams.set('gc_slot', metadata.slotId);
    }
    if (metadata.preset) {
      parsed.searchParams.set('gc_preset', metadata.preset);
    }
    if (metadata.cursorPreference) {
      parsed.searchParams.set('gc_cursor', metadata.cursorPreference);
    }
    if (metadata.appAudioTarget) {
      parsed.searchParams.set('appAudio', metadata.appAudioTarget);
    }
    if (typeof metadata.transportPreference !== 'undefined') {
      if (metadata.transportPreference === true || metadata.transportPreference === 'whipout') {
        parsed.searchParams.set('whipout', '1');
      } else if (metadata.transportPreference === false || metadata.transportPreference === 'p2p') {
        parsed.searchParams.delete('whipout');
      }
    }
    return parsed.toString();
  } catch (error) {
    console.warn('Failed to decorate invite URL for game capture:', error);
    return baseUrl;
  }
}

function buildWindowMetaSnapshot(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return null;
  }
  let bounds = null;
  try {
    bounds = windowInstance.getBounds();
  } catch (error) {
    bounds = null;
  }
  return {
    isAlwaysOnTop: safeIsAlwaysOnTop(windowInstance),
    isMinimized: safeIsMinimized(windowInstance),
    isVisible: safeIsVisible(windowInstance),
    isFullScreen: safeIsFullScreen(windowInstance),
    width: bounds ? bounds.width : null,
    height: bounds ? bounds.height : null,
    zoomFactor: safeGetZoomFactor(windowInstance),
    maximized: safeIsMaximized(windowInstance),
    windowId: windowInstance.id
  };
}

function safeIsAlwaysOnTop(windowInstance) {
  try {
    return windowInstance.isAlwaysOnTop();
  } catch (error) {
    return false;
  }
}

function safeIsMinimized(windowInstance) {
  try {
    return windowInstance.isMinimized();
  } catch (error) {
    return false;
  }
}

function safeIsVisible(windowInstance) {
  try {
    return windowInstance.isVisible();
  } catch (error) {
    return false;
  }
}

function safeIsFullScreen(windowInstance) {
  try {
    return windowInstance.isFullScreen();
  } catch (error) {
    return false;
  }
}

function safeIsMaximized(windowInstance) {
  try {
    return windowInstance.isMaximized();
  } catch (error) {
    return false;
  }
}

function safeGetZoomFactor(windowInstance) {
  try {
    return windowInstance.webContents.getZoomFactor();
  } catch (error) {
    return 1;
  }
}

function setWindowPinnedState(windowInstance, shouldPin) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return false;
  }
  try {
    if (shouldPin) {
      if (process.platform === 'darwin') {
        windowInstance.setAlwaysOnTop(true, 'floating', 1);
      } else {
        windowInstance.setAlwaysOnTop(true, 'level');
      }
      windowInstance.setVisibleOnAllWorkspaces(true);
    } else {
      windowInstance.setAlwaysOnTop(false);
      windowInstance.setVisibleOnAllWorkspaces(false);
    }
    if (windowInstance.args) {
      windowInstance.args.pin = !!shouldPin;
    }
    return true;
  } catch (error) {
    console.warn('Unable to toggle pin state:', error);
    return false;
  }
}

function handleGameCaptureDeepLink(args, source = 'deeplink') {
  const normalizedMode = normalizeModeValue(args && args.mode);
  if (normalizedMode !== 'game') {
    return false;
  }
  const inviteUrl = sanitizeInviteUrl(
    (args && (args.__originalUrl || args.url)) || ''
  );
  if (!inviteUrl) {
    return false;
  }
  const targetWindow = getPrimaryGameCaptureWindow({ requireGameMode: true });
  if (!targetWindow) {
    return false;
  }
  const metadata = {
    slotId: args && (args.slotId || args.slot),
    preset: args && args.preset,
    cursorPreference: args && args.cursor,
    transportPreference: typeof (args && args.whipout) !== 'undefined' ? args.whipout : undefined,
    appAudioTarget: args && args.appaudio
  };
  const applied = applyInviteToWindow(targetWindow, {
    ...metadata,
    inviteUrl,
    reason: source
  });
  if (!applied) {
    return false;
  }
  if (!isWindowDisplayingGameShell(targetWindow)) {
    launchInviteInWindow(targetWindow, inviteUrl, metadata);
  }
  return true;
}

const STREAM_ID_DICTIONARY = (Array.isArray(STREAM_ID_WORDS) ? STREAM_ID_WORDS : []).filter((entry) => typeof entry === 'string' && entry.trim().length);

function getShareProfilePath() {
  try {
    return path.join(app.getPath('userData'), SHARE_PROFILE_FILENAME);
  } catch (error) {
    const prefix = app && app.name ? app.name : 'electroncapture';
    return path.join(os.tmpdir(), `${prefix}-${SHARE_PROFILE_FILENAME}`);
  }
}

function normalizeShareProfileStructure(profile) {
  const normalized = {
    ...DEFAULT_SHARE_PROFILE,
    ...(profile || {})
  };
  normalized.advanced = {
    ...DEFAULT_SHARE_PROFILE.advanced,
    ...(profile && profile.advanced ? profile.advanced : {})
  };
  normalized.version = SHARE_PROFILE_VERSION;
  return normalized;
}

function readShareProfileFromDisk() {
  try {
    const profilePath = getShareProfilePath();
    if (!fs.existsSync(profilePath)) {
      return null;
    }
    const raw = fs.readFileSync(profilePath, 'utf8');
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return normalizeShareProfileStructure(parsed);
  } catch (error) {
    console.warn('Unable to load share profile from disk:', error);
    return null;
  }
}

function persistShareProfile(profile) {
  if (!profile) {
    return;
  }
  try {
    const profilePath = getShareProfilePath();
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, JSON.stringify(profile, null, 2), 'utf8');
  } catch (error) {
    console.warn('Unable to persist share profile:', error);
  }
}

function ensureShareProfileLoaded() {
  if (shareProfileCache.profile) {
    return shareProfileCache.profile;
  }
  let normalized = readShareProfileFromDisk();
  let mutated = false;
  if (!normalized) {
    normalized = normalizeShareProfileStructure(null);
    mutated = true;
  }
  if (!normalized.streamId) {
    const generated = generateStreamIdValue({
      mode: normalized.streamIdMode,
      wordCount: normalized.streamIdWordCount
    });
    normalized.streamId = generated.value;
    normalized.streamIdMode = generated.mode;
    normalized.streamIdWordCount = generated.wordCount;
    normalized.streamIdGeneratedAt = Date.now();
    mutated = true;
  }
  shareProfileCache.profile = normalized;
  if (mutated) {
    persistShareProfile(normalized);
  }
  return normalized;
}

function secureRandomInt(max) {
  if (!Number.isFinite(max) || max <= 0) {
    return 0;
  }
  const rand = crypto.randomBytes(4).readUInt32BE(0);
  return rand % max;
}

function pickStreamDictionaryWord() {
  if (STREAM_ID_DICTIONARY.length === 0) {
    const fallbacks = ['versus', 'ninja', 'capture', 'vector', 'ember', 'orbit'];
    return fallbacks[secureRandomInt(fallbacks.length)];
  }
  return STREAM_ID_DICTIONARY[secureRandomInt(STREAM_ID_DICTIONARY.length)];
}

function formatStreamWordToken(word) {
  if (!word || typeof word !== 'string') {
    return '';
  }
  const cleaned = word.replace(/[^A-Za-z]/g, '');
  if (!cleaned.length) {
    return '';
  }
  const lower = cleaned.toLowerCase();
  if (secureRandomInt(100) < 60) {
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }
  if (secureRandomInt(100) < 30) {
    return lower.toUpperCase();
  }
  return lower;
}

function generateAlphanumericId(length = 10, preferUppercase = true) {
  const chars = STREAM_ID_ALPHABET_WITH_UNDERSCORE;
  let result = '';
  for (let i = 0; i < Math.max(1, length); i++) {
    const idx = secureRandomInt(chars.length);
    let char = chars.charAt(idx);
    if (preferUppercase && /[a-z]/.test(char) && secureRandomInt(100) < 60) {
      char = char.toUpperCase();
    }
    result += char;
  }
  if (!/[0-9]/.test(result)) {
    const insertIndex = secureRandomInt(result.length);
    const digit = secureRandomInt(10).toString();
    result = result.slice(0, insertIndex) + digit + result.slice(insertIndex + (result.length > 1 ? 1 : 0));
  }
  if (!/_/.test(result) && secureRandomInt(100) < 40) {
    const insertIndex = secureRandomInt(result.length + 1);
    result = result.slice(0, insertIndex) + '_' + result.slice(insertIndex);
  }
  return result;
}

function generateWordStyleIdPayload(preferredCount) {
  let count = Number.isFinite(preferredCount) ? Math.trunc(preferredCount) : null;
  if (!count || count < STREAM_ID_MIN_WORDS || count > STREAM_ID_MAX_WORDS) {
    count = STREAM_ID_MIN_WORDS + secureRandomInt(STREAM_ID_MAX_WORDS);
    count = Math.max(STREAM_ID_MIN_WORDS, Math.min(STREAM_ID_MAX_WORDS, count));
  }
  const words = [];
  for (let i = 0; i < count; i++) {
    const token = formatStreamWordToken(pickStreamDictionaryWord());
    if (token) {
      words.push(token);
    }
  }
  if (!words.length) {
    words.push('Versus');
  }
  const joinWithUnderscore = count > 1 && secureRandomInt(100) < 50;
  let base = joinWithUnderscore ? words.join('_') : words.join('');
  if (!base.length) {
    base = generateAlphanumericId(6);
  }
  if (!base.includes('_') && secureRandomInt(100) < 35) {
    base += '_';
  }
  const suffix = `${generateAlphanumericId(1, true)}${secureRandomInt(10)}${generateAlphanumericId(1, false)}`;
  let finalValue = `${base}${suffix}`;
  if (finalValue.length < 12) {
    finalValue += generateAlphanumericId(12 - finalValue.length, false);
  } else if (finalValue.length > 20) {
    finalValue = finalValue.slice(0, 20);
  }
  return {
    value: finalValue,
    wordCount: count
  };
}

function normalizeStreamIdModePreference(value) {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (['alpha', 'alphanumeric', 'random', 'plain'].includes(token)) {
    return 'alphanumeric';
  }
  return 'words';
}

function generateStreamIdValue(options = {}) {
  const normalizedMode = normalizeStreamIdModePreference(options.mode);
  if (normalizedMode === 'alphanumeric') {
    const targetLength = Number.isFinite(options.length)
      ? Math.max(6, Math.min(24, Math.trunc(options.length)))
      : (secureRandomInt(100) < 50 ? 9 : 10);
    return {
      value: generateAlphanumericId(targetLength, true),
      wordCount: 0,
      mode: 'alphanumeric'
    };
  }
  const payload = generateWordStyleIdPayload(options.wordCount);
  return {
    value: payload.value,
    wordCount: payload.wordCount,
    mode: 'words'
  };
}

function mutateShareProfile(mutator) {
  const current = ensureShareProfileLoaded();
  const draft = JSON.parse(JSON.stringify(current));
  if (typeof mutator === 'function') {
    mutator(draft);
  }
  draft.version = SHARE_PROFILE_VERSION;
  draft.updatedAt = Date.now();
  draft.advanced = {
    ...DEFAULT_SHARE_PROFILE.advanced,
    ...(draft.advanced || {})
  };
  shareProfileCache.profile = draft;
  persistShareProfile(draft);
  return draft;
}

function regenerateShareStreamId(options = {}) {
  mutateShareProfile((draft) => {
    const generated = generateStreamIdValue(options);
    draft.streamId = generated.value;
    draft.streamIdMode = generated.mode;
    draft.streamIdWordCount = generated.wordCount;
    draft.streamIdGeneratedAt = Date.now();
  });
}

function normalizeShareRoomCode(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const sanitized = value.trim().replace(/[^A-Za-z0-9_-]/g, '');
  return sanitized.slice(0, 48);
}

function normalizeSharePassword(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, 64);
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  let result = numeric;
  if (typeof min === 'number' && result < min) {
    result = min;
  }
  if (typeof max === 'number' && result > max) {
    result = max;
  }
  return result;
}

function resolveShareBaseUrl(value, fallback = DEFAULT_VDO_BASE_URL) {
  if (typeof value !== 'string' || !value.trim().length) {
    return fallback;
  }
  const trimmed = value.trim();
  try {
    const candidate = new URL(trimmed);
    candidate.search = '';
    candidate.hash = '';
    if (!candidate.pathname || candidate.pathname === '') {
      candidate.pathname = '/';
    }
    if (!candidate.pathname.endsWith('/')) {
      candidate.pathname += '/';
    }
    return candidate.toString();
  } catch (error) {
    try {
      const fallbackUrl = new URL(trimmed, fallback);
      fallbackUrl.search = '';
      fallbackUrl.hash = '';
      if (!fallbackUrl.pathname.endsWith('/')) {
        fallbackUrl.pathname += '/';
      }
      return fallbackUrl.toString();
    } catch (fallbackError) {
      console.warn('Unable to normalize share base URL:', fallbackError);
      return fallback;
    }
  }
}

function buildVdoUrl(base, params) {
  const normalizedBase = resolveShareBaseUrl(base, DEFAULT_VDO_BASE_URL);
  let target;
  try {
    target = new URL(normalizedBase);
  } catch (error) {
    console.warn('Invalid VDO base URL, falling back to default:', error);
    target = new URL(DEFAULT_VDO_BASE_URL);
  }
  target.search = '';
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) {
      return;
    }
    target.searchParams.set(key, String(value));
  });
  return target.toString();
}

function buildPublishParams(profile, advanced) {
  const publishBitrate = clampNumber(
    advanced.publishBitrateKbps,
    500,
    20000,
    DEFAULT_SHARE_PROFILE.advanced.publishBitrateKbps
  );
  const audioBitrate = clampNumber(
    advanced.audioBitrateKbps,
    48,
    512,
    DEFAULT_SHARE_PROFILE.advanced.audioBitrateKbps
  );
  // VDO bitrate params are in kbps. `scene` is left off: on a publisher it switches
  // VDO into scene mode, which disables the web-audio mixer (game + mic audio).
  // `autostart` is left off too: in Electron it skips the source picker and
  // broadcasts the whole first monitor without asking.
  const params = {
    push: profile.streamId,
    screenshare: 1,
    bitrate: Math.round(publishBitrate),
    outboundvideobitrate: Math.round(publishBitrate),
    ab: Math.round(audioBitrate),
    stereo: advanced.stereo ? 1 : undefined,
    room: profile.roomCode || undefined,
    password: profile.roomPassword || undefined,
    cleanoutput: 2,
    label: 'VersusGameCapture'
  };
  if (advanced.codec === 'h264') {
    params.h264 = 1;
  } else if (advanced.codec === 'vp9') {
    params.vp9 = 1;
  } else if (advanced.codec === 'av1') {
    params.av1 = 1;
  }
  if (advanced.preferWhipRelay) {
    params.whipout = 1;
  }
  return params;
}

function buildViewParams(profile, advanced) {
  const viewBitrate = clampNumber(
    advanced.viewBitrateKbps,
    500,
    20000,
    DEFAULT_SHARE_PROFILE.advanced.viewBitrateKbps
  );
  const audioBitrate = clampNumber(
    advanced.audioBitrateKbps,
    48,
    512,
    DEFAULT_SHARE_PROFILE.advanced.audioBitrateKbps
  );
  // No `stats` here: it pops the stats overlay on load, which would show up in OBS.
  const params = {
    view: profile.streamId,
    cleanoutput: 2,
    quality: 0,
    scene: 0,
    bitrate: Math.round(viewBitrate),
    ab: Math.round(audioBitrate),
    stereo: advanced.stereo ? 1 : undefined,
    room: profile.roomCode || undefined,
    password: profile.roomPassword || undefined,
    label: 'VersusGameCapture'
  };
  if (advanced.codec === 'h264') {
    params.h264 = 1;
  } else if (advanced.codec === 'vp9') {
    params.vp9 = 1;
  } else if (advanced.codec === 'av1') {
    params.av1 = 1;
  }
  return params;
}

function buildShareLinksFromProfile(profile, advanced) {
  const baseHost = resolveShareBaseUrl(advanced.baseHost, DEFAULT_VDO_BASE_URL);
  const publishParams = buildPublishParams(profile, advanced);
  const viewParams = buildViewParams(profile, advanced);
  return {
    publish: buildVdoUrl(baseHost, publishParams),
    view: buildVdoUrl(baseHost, viewParams),
    publishParams,
    viewParams,
    baseHost
  };
}

function buildShareProfilePayload() {
  const profile = ensureShareProfileLoaded();
  const advanced = {
    ...DEFAULT_SHARE_PROFILE.advanced,
    ...(profile.advanced || {})
  };
  const shareLinks = buildShareLinksFromProfile(profile, advanced);
  return {
    streamId: profile.streamId,
    streamIdMode: profile.streamIdMode || 'words',
    streamIdWordCount: profile.streamIdWordCount || 0,
    streamIdGeneratedAt: profile.streamIdGeneratedAt || null,
    roomCode: profile.roomCode || '',
    roomPassword: profile.roomPassword || '',
    advanced,
    defaults: {
      baseHost: DEFAULT_VDO_BASE_URL,
      publishBitrateKbps: DEFAULT_SHARE_PROFILE.advanced.publishBitrateKbps,
      viewBitrateKbps: DEFAULT_SHARE_PROFILE.advanced.viewBitrateKbps
    },
    shareLinks,
    qualitySummary: {
      preset: advanced.qualityPreset,
      publishBitrateKbps: advanced.publishBitrateKbps,
      viewBitrateKbps: advanced.viewBitrateKbps,
      codec: advanced.codec,
      stereo: !!advanced.stereo,
      preferWhipRelay: !!advanced.preferWhipRelay
    }
  };
}

function attachShareProfileToWindow(windowInstance) {
  if (!windowInstance || windowInstance.isDestroyed()) {
    return null;
  }
  const payload = buildShareProfilePayload();
  updateGameCaptureState(windowInstance, { shareProfile: payload });
  return payload;
}

function broadcastShareProfileUpdate(reason = 'share-profile-updated') {
  const payload = buildShareProfilePayload();
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win || win.isDestroyed()) {
      return;
    }
    updateGameCaptureState(win, { shareProfile: payload });
    pushGameCaptureUpdate(win, reason);
  });
  return payload;
}

function updateStoredShareProfile(payload = {}) {
  mutateShareProfile((draft) => {
    if (Object.prototype.hasOwnProperty.call(payload, 'roomCode')) {
      draft.roomCode = normalizeShareRoomCode(payload.roomCode);
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'roomPassword')) {
      draft.roomPassword = normalizeSharePassword(payload.roomPassword);
    }
    if (payload.streamId && typeof payload.streamId === 'string') {
      const trimmed = payload.streamId.trim();
      if (/^[A-Za-z0-9_]{4,40}$/.test(trimmed)) {
        draft.streamId = trimmed;
        draft.streamIdGeneratedAt = Date.now();
        draft.streamIdMode = 'manual';
        draft.streamIdWordCount = 0;
      }
    }
    if (payload.advanced && typeof payload.advanced === 'object') {
      draft.advanced = draft.advanced || {};
      if (Object.prototype.hasOwnProperty.call(payload.advanced, 'baseHost')) {
        const requestedHost = typeof payload.advanced.baseHost === 'string' ? payload.advanced.baseHost.trim() : '';
        // An empty value resets to the default host; anything that isn't http(s) is ignored.
        if (!requestedHost.length) {
          draft.advanced.baseHost = DEFAULT_VDO_BASE_URL;
        } else if (/^https?:\/\//i.test(requestedHost)) {
          draft.advanced.baseHost = resolveShareBaseUrl(
            requestedHost,
            draft.advanced.baseHost || DEFAULT_VDO_BASE_URL
          );
        }
      }
      if (Object.prototype.hasOwnProperty.call(payload.advanced, 'publishBitrateKbps')) {
        draft.advanced.publishBitrateKbps = clampNumber(
          payload.advanced.publishBitrateKbps,
          500,
          20000,
          draft.advanced.publishBitrateKbps
        );
      }
      if (Object.prototype.hasOwnProperty.call(payload.advanced, 'viewBitrateKbps')) {
        draft.advanced.viewBitrateKbps = clampNumber(
          payload.advanced.viewBitrateKbps,
          500,
          20000,
          draft.advanced.viewBitrateKbps
        );
      }
      if (Object.prototype.hasOwnProperty.call(payload.advanced, 'audioBitrateKbps')) {
        draft.advanced.audioBitrateKbps = clampNumber(
          payload.advanced.audioBitrateKbps,
          48,
          512,
          draft.advanced.audioBitrateKbps
        );
      }
      if (Object.prototype.hasOwnProperty.call(payload.advanced, 'codec')) {
        const codecToken = typeof payload.advanced.codec === 'string'
          ? payload.advanced.codec.trim().toLowerCase()
          : '';
        if (['h264', 'vp9', 'av1'].includes(codecToken)) {
          draft.advanced.codec = codecToken;
        }
      }
      if (Object.prototype.hasOwnProperty.call(payload.advanced, 'stereo')) {
        draft.advanced.stereo = !!payload.advanced.stereo;
      }
      if (Object.prototype.hasOwnProperty.call(payload.advanced, 'preferWhipRelay')) {
        draft.advanced.preferWhipRelay = !!payload.advanced.preferWhipRelay;
      }
      if (Object.prototype.hasOwnProperty.call(payload.advanced, 'hideCursor')) {
        draft.advanced.hideCursor = !!payload.advanced.hideCursor;
      }
      if (Object.prototype.hasOwnProperty.call(payload.advanced, 'qualityPreset')) {
        const presetToken = typeof payload.advanced.qualityPreset === 'string'
          ? payload.advanced.qualityPreset.trim()
          : '';
        if (presetToken.length) {
          draft.advanced.qualityPreset = presetToken;
        }
      }
    }
  });
  return buildShareProfilePayload();
}


ipcMain.handle('noCORSFetch', async (event, args) => {
  const streamId = Date.now().toString();
  
  try {
    const isHttps = args.url.toLowerCase().startsWith('https://');
    const fetchOptions = {
      method: args.method || 'GET',
      headers: {
        ...args.headers
      }
    };

    // Add dispatcher with SSL verification disabled for HTTPS URLs
    if (isHttps) {
      fetchOptions.dispatcher = new (require('undici').Agent)({
        connect: {
          rejectUnauthorized: false
        }
      });
    }

    const response = await undiciFetch(args.url, fetchOptions);
    
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText
      };
    }

    const contentType = response.headers.get('content-type') || '';
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    const boundary = boundaryMatch ? boundaryMatch[1] : null;
    const reader = response.body.getReader();
    
    activeStreams.set(streamId, {
      reader,
      buffer: Buffer.alloc(0)
    });

    return {
      ok: true,
      status: response.status,
      streamId,
      contentType,
      boundary: boundary ? `${boundary}` : null
    };
  } catch (error) {
    console.error('Fetch error:', error);
    return {
      ok: false,
      error: error.message
    };
  }
});

ipcMain.handle('gamecapture:get-context', (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    return buildGameCaptureContext(win);
  } catch (error) {
    console.warn('gamecapture:get-context failed:', error);
    return null;
  }
});

ipcMain.handle('gamecapture:launch-invite', (event, payload) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: 'missing-window' };
    }
    const targetUrl = typeof payload === 'string'
      ? payload
      : (payload && (payload.url || payload.inviteUrl));
    if (!targetUrl || !String(targetUrl).trim().length) {
      return { success: false, error: 'invalid-url' };
    }
    const meta = {
      slotId: payload && (payload.slotId || payload.slot),
      preset: payload && payload.preset,
      cursorPreference: payload && (payload.cursorPreference || payload.cursor),
      appAudioTarget: payload && (payload.appAudioTarget || payload.appaudio || payload.appAudio),
      transportPreference: typeof (payload && payload.transportPreference) !== 'undefined'
        ? payload.transportPreference
        : (typeof (payload && payload.whipout) !== 'undefined' ? payload.whipout : undefined)
    };
    return launchInviteInWindow(win, targetUrl, meta);
  } catch (error) {
    console.warn('gamecapture:launch-invite failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gamecapture:return-to-shell', (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    return returnWindowToShell(win);
  } catch (error) {
    console.warn('gamecapture:return-to-shell failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gamecapture:get-share-profile', () => {
  try {
    return buildShareProfilePayload();
  } catch (error) {
    console.warn('gamecapture:get-share-profile failed:', error);
    return null;
  }
});

ipcMain.handle('gamecapture:update-share-profile', (_event, payload) => {
  try {
    updateStoredShareProfile(payload || {});
    return broadcastShareProfileUpdate('share-profile-updated');
  } catch (error) {
    console.warn('gamecapture:update-share-profile failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gamecapture:regenerate-stream-id', (_event, payload) => {
  try {
    regenerateShareStreamId(payload || {});
    return broadcastShareProfileUpdate('share-id-regenerated');
  } catch (error) {
    console.warn('gamecapture:regenerate-stream-id failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gamecapture:open-external', async (_event, rawUrl) => {
  try {
    const parsed = new URL(String(rawUrl || ''));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { success: false, error: 'unsupported-url' };
    }
    await shell.openExternal(parsed.toString());
    return { success: true };
  } catch (error) {
    console.warn('gamecapture:open-external failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gamecapture:copy-text', (_event, text) => {
  try {
    if (typeof text !== 'string' || !text.length) {
      return { success: false, error: 'empty' };
    }
    electron.clipboard.writeText(text);
    return { success: true };
  } catch (error) {
    console.warn('gamecapture:copy-text failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.on('gamecapture:debug-log', (_event, payload) => {
  try {
    console.log('[gamecapture-debug]', formatGameCaptureDebugPayload(payload));
  } catch (error) {
    console.warn('gamecapture:debug-log failed:', error);
  }
});

ipcMain.handle('gamecapture:window-action', (event, payload = {}) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: 'missing-window' };
    }
    const action = typeof payload.action === 'string' ? payload.action : '';
    switch (action) {
      case 'minimize':
        win.minimize();
        break;
      case 'restore':
        if (win.isMinimized()) {
          win.restore();
        } else {
          win.focus();
        }
        break;
      case 'close':
        win.close();
        break;
      case 'toggle-pin': {
        const desired = typeof payload.target === 'boolean' ? payload.target : !safeIsAlwaysOnTop(win);
        setWindowPinnedState(win, desired);
        break;
      }
      case 'toggle-fullscreen':
        win.setFullScreen(!win.isFullScreen());
        break;
      default:
        console.warn('Unsupported window action requested:', action);
        return { success: false, error: 'unsupported-action' };
    }
    pushGameCaptureUpdate(win, 'window-action');
    return {
      success: true,
      state: buildWindowMetaSnapshot(win)
    };
  } catch (error) {
    console.warn('gamecapture:window-action failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gamecapture:window-resize', (event, payload = {}) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: 'missing-window' };
    }
    const rawWidth = Number(payload.width);
    const rawHeight = Number(payload.height);
    if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight)) {
      return { success: false, error: 'invalid-dimensions' };
    }
    const width = Math.max(400, Math.round(rawWidth));
    const height = Math.max(300, Math.round(rawHeight));
    if (win.args) {
      win.args.width = width;
      win.args.height = height;
    }
    win.setFullScreen(false);
    win.setBounds({ ...win.getBounds(), width, height }, false);
    pushGameCaptureUpdate(win, 'window-resized');
    return {
      success: true,
      state: buildWindowMetaSnapshot(win)
    };
  } catch (error) {
    console.warn('gamecapture:window-resize failed:', error);
    return { success: false, error: error.message };
  }
});

// Rest of the code remains unchanged
ipcMain.handle('readStreamChunk', async (event, streamId) => {
  const stream = activeStreams.get(streamId);
  if (!stream) return { done: true };
  try {
    const { done, value } = await stream.reader.read();
    if (done) {
      activeStreams.delete(streamId);
      return { done: true };
    }
    return { 
      done: false, 
      value: Array.from(value)
    };
  } catch (error) {
    console.error('Stream read error:', error);
    activeStreams.delete(streamId);
    throw error;
  }
});

ipcMain.handle('closeStream', async (event, streamId) => {
  const stream = activeStreams.get(streamId);
  if (stream?.reader) {
    try {
      await stream.reader.cancel();
    } catch (e) {
      console.error('Error closing stream:', e);
    }
    activeStreams.delete(streamId);
  }
  return true;
});

function normalizeAudioCaptureTarget(rawTarget) {
	if (rawTarget === null || rawTarget === undefined) {
		return null;
	}
	if (typeof rawTarget === 'number') {
		if (!Number.isFinite(rawTarget) || rawTarget <= 0) {
			return null;
		}
		return {
			requestTarget: rawTarget,
			clientId: String(rawTarget)
		};
	}
	if (typeof rawTarget === 'string') {
		const trimmed = rawTarget.trim();
		if (!trimmed.length) {
			return null;
		}
		if (/^\d+$/.test(trimmed)) {
			const numericValue = Number(trimmed);
			if (!Number.isFinite(numericValue) || numericValue <= 0) {
				return null;
			}
			return {
				requestTarget: numericValue,
				clientId: trimmed
			};
		}
		return {
			requestTarget: trimmed,
			clientId: trimmed
		};
	}
	return null;
}

async function stopActiveWindowAudioCapture(reason = 'unknown', expectedWebContentsId = null) {
	if (!windowAudioCapture || typeof windowAudioCapture.stopStreamCapture !== 'function') {
		activeWindowAudioSession = null;
		return { success: false, error: 'window-audio-capture module unavailable' };
	}
	if (!activeWindowAudioSession) {
		return { success: true };
	}
	if (expectedWebContentsId !== null && activeWindowAudioSession.webContentsId !== expectedWebContentsId) {
		return { success: true };
	}

	const { webContents, destroyListener } = activeWindowAudioSession;

	if (webContents && !webContents.isDestroyed() && typeof destroyListener === 'function') {
		webContents.removeListener('destroyed', destroyListener);
	}

	activeWindowAudioSession = null;

	try {
		await windowAudioCapture.stopStreamCapture();
		return { success: true };
	} catch (error) {
		console.warn('Error stopping window audio capture (' + reason + '):', error);
		return { success: false, error: error.message || 'Failed to stop window audio capture' };
	}
}

function forwardWindowAudioData(webContents, clientId, baseSampleRate, baseChannels, payload) {
	if (!payload || !webContents || webContents.isDestroyed()) {
		return;
	}

	const data = payload && payload.data ? payload.data : payload;
	if (!data) {
		return;
	}

	let samples = data.samples;

	if (!(samples instanceof Float32Array)) {
		if (Array.isArray(samples) || (samples && typeof samples.length === 'number')) {
			try {
				samples = Float32Array.from(samples);
			} catch (err) {
				console.warn('Failed to convert audio samples to Float32Array:', err);
				samples = new Float32Array(0);
			}
		} else {
			samples = new Float32Array(0);
		}
	}

	const message = {
		clientId,
		data: {
			samples,
			sampleRate: data.sampleRate || baseSampleRate || 48000,
			channels: data.channels || baseChannels || 2
		}
	};

	try {
		webContents.send(WINDOW_AUDIO_EVENT_CHANNEL, message);
	} catch (error) {
		console.warn('Failed to forward window audio data to renderer:', error);
	}
}

ipcMain.handle('windowAudio:getTargets', async () => {
	const available = windowAudioCaptureAvailable && !!windowAudioCapture;
	if (!available) {
		return { success: false, error: 'window-audio-capture module unavailable' };
	}
	try {
		const windows = typeof windowAudioCapture.getWindowList === 'function' ? await windowAudioCapture.getWindowList() : [];
		const sessions = typeof windowAudioCapture.getAudioSessions === 'function' ? await windowAudioCapture.getAudioSessions() : [];
		return { success: true, windows, sessions };
	} catch (error) {
		console.error('Error retrieving window audio targets:', error);
		return { success: false, error: error.message || 'Failed to retrieve audio targets' };
	}
});

ipcMain.handle('windowAudio:getSessions', async () => {
	const available = windowAudioCaptureAvailable && !!windowAudioCapture;
	if (!available || typeof windowAudioCapture.getAudioSessions !== 'function') {
		return { success: false, error: 'window-audio-capture module unavailable' };
	}
	try {
		const sessions = await windowAudioCapture.getAudioSessions();
		return { success: true, sessions };
	} catch (error) {
		console.error('Error retrieving window audio sessions:', error);
		return { success: false, error: error.message || 'Failed to retrieve audio sessions' };
	}
});

ipcMain.handle('windowAudio:startStreamCapture', async (event, rawTarget) => {
	const available = windowAudioCaptureAvailable && !!windowAudioCapture;
	if (!available || typeof windowAudioCapture.startStreamCapture !== 'function') {
		return { success: false, error: 'window-audio-capture module unavailable' };
	}

	const normalized = normalizeAudioCaptureTarget(rawTarget);
	if (!normalized) {
		return { success: false, error: 'Invalid window audio capture target' };
	}

	const webContents = event.sender;

	await stopActiveWindowAudioCapture('pre-start cleanup');

	const baseSampleRateFallback = 48000;
	const baseChannelFallback = 2;

	const forwarder = (payload) => {
		if (!activeWindowAudioSession || activeWindowAudioSession.webContentsId !== webContents.id) {
			return;
		}
		const sampleRate = activeWindowAudioSession.sampleRate || baseSampleRateFallback;
		const channels = activeWindowAudioSession.channels || baseChannelFallback;
		forwardWindowAudioData(webContents, normalized.clientId, sampleRate, channels, payload);
	};

	let startResult;
	try {
		startResult = await windowAudioCapture.startStreamCapture(normalized.requestTarget, forwarder);
	} catch (error) {
		console.error('Error starting window audio capture:', error);
		return { success: false, error: error.message || 'Failed to start window audio capture' };
	}

	if (!startResult || startResult.success === false) {
		return { success: false, error: startResult && startResult.error ? startResult.error : 'Failed to start window audio capture' };
	}

	const destroyListener = () => {
		stopActiveWindowAudioCapture('renderer destroyed', webContents.id).catch(err => {
			console.warn('Error stopping window audio capture after renderer destroyed:', err);
		});
	};

	if (!webContents.isDestroyed()) {
		webContents.once('destroyed', destroyListener);
	}

	activeWindowAudioSession = {
		webContents,
		webContentsId: webContents.id,
		clientId: normalized.clientId,
		destroyListener,
		sampleRate: startResult.sampleRate || baseSampleRateFallback,
		channels: startResult.channels || baseChannelFallback
	};

	return {
		success: true,
		sampleRate: activeWindowAudioSession.sampleRate,
		channels: activeWindowAudioSession.channels,
		usingProcessSpecificLoopback: !!(startResult && startResult.usingProcessSpecificLoopback)
	};
});

ipcMain.handle('windowAudio:stopStreamCapture', async (event) => {
	const available = windowAudioCaptureAvailable && !!windowAudioCapture;
	if (!available || typeof windowAudioCapture.stopStreamCapture !== 'function') {
		return { success: false, error: 'window-audio-capture module unavailable' };
	}

	const result = await stopActiveWindowAudioCapture('renderer request', event && event.sender ? event.sender.id : null);
	if (!result.success && result.error) {
		return result;
	}

	return { success: true };
});

ipcMain.handle('prompt', async (event, arg) => {
  try {
    arg.val = arg.val || '';
    arg.title = arg.title.replace("\n","<br /><br />");
    const result = await prompt({
      title: "",
      label: arg.title,
      width: 700,
      useHtmlLabel: true,
      inputAttrs: {
        type: 'string',
        placeholder: arg.val
      },
      type: 'input',
      resizable: true,
      alwaysOnTop: true
    });
    
    if(result === null) {
      console.log('user cancelled');
      return null;
    } else {
      console.log('result', result);
      return result;
    }
  } catch(e) {
    console.error(e);
    throw e;
  }
});


async function createWindow(args, reuse=false) {
  var webSecurity = true;
  
  // Check if args are valid
  if (!args || typeof args !== 'object') {
    console.error('Invalid args passed to createWindow:', args);
    args = createYargs(); // Use default args if invalid
  }
  
  var URL = args.url, NODE = args.node, WIDTH = args.width, HEIGHT = args.height, TITLE = args.title, PIN = args.pin, X = args.x, Y = args.y, FULLSCREEN = args.fullscreen, UNCLICKABLE = args.uc, MINIMIZED = args.min, CSS = args.css, BGCOLOR = args.chroma, JS = args.js;


  let nodeExplicitFlag = args.__nodeExplicit === true;

  const assignNodeIntegration = (value, markExplicit = true) => {
    if (typeof value !== 'boolean') {
      return;
    }
    NODE = value;
    args.node = value;
    args.n = value;
    if (markExplicit) {
      nodeExplicitFlag = true;
    }
  };

  if (typeof NODE !== 'boolean') {
    assignNodeIntegration(true, false);
  }

	if (typeof URL === 'string') {
		URL = formatURL(URL.trim());
	} else if (URL != null) {
		try {
			URL = formatURL(String(URL));
    } catch (conversionError) {
      console.warn('Unable to normalize URL value from args:', conversionError);
    }
	}

	args.url = URL;

	const normalizedModeForWindow = normalizeModeValue(args.mode) || normalizeModeValue(Argv && Argv.mode) || normalizeModeValue(DEFAULT_MODE);
	if (normalizedModeForWindow) {
		args.mode = normalizedModeForWindow;
	}
	const originalUrlForWindow = typeof args.__originalUrl === 'string' ? args.__originalUrl : URL;
	let pendingInviteUrl = null;
      let launchingGameShell = false;
      if (normalizedModeForWindow === 'game') {
              if (shouldTreatUrlAsInviteCandidate(originalUrlForWindow)) {
                      pendingInviteUrl = originalUrlForWindow;
              }
              URL = GAME_CAPTURE_SHELL_URL;
              args.url = URL;
              launchingGameShell = true;
      }

	const urlForNodePreference = launchingGameShell && typeof originalUrlForWindow === 'string' ? originalUrlForWindow : URL;

	if (!nodeExplicitFlag && typeof urlForNodePreference === 'string') {
		let preferenceResolved = false;
    try {
		const parsedUrl = new URL(urlForNodePreference);
      const nodeParamKeys = ['node', 'nodeintegration', 'nodeIntegration', 'enableNode'];
      for (const key of nodeParamKeys) {
        if (!parsedUrl.searchParams.has(key)) {
          continue;
        }
        const rawValue = parsedUrl.searchParams.get(key);
        if (rawValue === null || rawValue === '') {
          assignNodeIntegration(true);
          preferenceResolved = true;
        } else {
          const normalized = rawValue.trim().toLowerCase();
          if (/^(disable|disabled|off|no|false|0)$/i.test(normalized)) {
            assignNodeIntegration(false);
            preferenceResolved = true;
          } else if (/^(enable|enabled|on|yes|true|1)$/i.test(normalized)) {
            assignNodeIntegration(true);
            preferenceResolved = true;
          } else if (/^(auto)$/i.test(normalized)) {
            // leave for heuristic fallback
          } else {
            assignNodeIntegration(true);
            preferenceResolved = true;
          }
        }
        break;
      }
    } catch (error) {
      // ignore malformed URLs
    }

    if (!preferenceResolved) {
		const loweredUrl = urlForNodePreference.toLowerCase();
      if (loweredUrl.includes('screenshare') || loweredUrl.includes('appaudio')) {
        assignNodeIntegration(true);
        preferenceResolved = true;
      }
    }

    if (preferenceResolved) {
      nodeExplicitFlag = true;
    }
	  }

  args.__nodeExplicit = nodeExplicitFlag;

      const slotIdValue = args.slotId || args.slot || null;
      const presetValue = args.preset || null;
      const cursorPreferenceValue = args.cursor || null;
      const appAudioTargetValue = args.appaudio || args.appAudio || null;
      const transportPreferenceValue = typeof args.whipout !== 'undefined' ? args.whipout : null;

	const desiredImmutableWebPreferences = {
  	nodeIntegration: !!NODE,
  	nodeIntegrationInSubFrames: !!NODE,
  	contextIsolation: !NODE
  };

	const requestedWindowName = normalizeWindowName(args.windowName);
	if (requestedWindowName) {
		args.windowName = requestedWindowName;
		const existingWindow = getNamedWindowInstance(requestedWindowName);
		if (existingWindow) {
			if (!immutablePreferencesMatch(existingWindow, desiredImmutableWebPreferences)) {
				console.log(`Skipping reuse for "${requestedWindowName}" because immutable webPreferences differ.`);
			} else {
				console.log(`Reusing existing window named "${requestedWindowName}".`);
				if (applyArgsToExistingWindow(existingWindow, args)) {
					updateGameCaptureState(existingWindow, {
						mode: normalizedModeForWindow || null,
						landingUrl: GAME_CAPTURE_SHELL_URL,
						pendingInviteUrl: pendingInviteUrl || null,
						activeInviteUrl: normalizedModeForWindow === 'game' ? null : originalUrlForWindow,
						lastInviteUrl: pendingInviteUrl || null,
						slotId: slotIdValue || null,
						preset: presetValue || null,
						cursorPreference: cursorPreferenceValue || null,
						appAudioTarget: appAudioTargetValue || null,
						transportPreference: transportPreferenceValue
					});
					attachShareProfileToWindow(existingWindow);
					if (normalizedModeForWindow === 'game') {
						pushGameCaptureUpdate(existingWindow, 'window-reused');
					}
					return existingWindow;
				}
				console.warn(`Failed to reuse window "${requestedWindowName}" cleanly; creating a new window instead.`);
			}
		}
	} else if (args.windowName) {
		delete args.windowName;
	}

	const initialDisplay = resolveDisplayForArgs(args) || getPrimaryDisplaySafe();
	let factor = (initialDisplay && initialDisplay.scaleFactor) || (getPrimaryDisplaySafe()?.scaleFactor) || 1;
  
  console.log(args);
  
  var CSSCONTENT = "";
  
  if (BGCOLOR){
    CSSCONTENT = "body {background-color:#"+BGCOLOR+"!important;}";
  }
  
  if (CSS){
    var p = path.join(__dirname, '.', CSS);
    console.log("Trying: "+p);
    
    // Convert to use Promise explicitly instead of await
    try {
      let cssData = null;
      try {
        cssData = fs.readFileSync(p, 'utf8');
      } catch(e) {
        // Try alternate path
        cssData = fs.readFileSync(CSS, 'utf8');
      }
      
      if (cssData) {
        CSSCONTENT += cssData;
        console.log("Loaded specified CSS file.");
      }
    } catch(e) {
      console.log("Couldn't read specified CSS file:", e);
    }
  }
  
  var JSCONTENT = "";

  if (JS){
    var p = path.join(__dirname, '.', JS);
    console.log("Trying JS file: "+p);
    
    // Convert to use Promise explicitly instead of await
    try {
      let jsData = null;
      try {
        jsData = fs.readFileSync(p, 'utf8');
      } catch(e) {
        // Try alternate path
        jsData = fs.readFileSync(JS, 'utf8');
      }
      
      if (jsData) {
        JSCONTENT += jsData;
        console.log("Loaded specified JS file.");
      }
    } catch(e) {
      console.log("Couldn't read specified JS file:", e);
    }
  }
  
  try {
    if (URL.startsWith("file:")){
      if (!launchingGameShell) {
        webSecurity = false;
      }
    } else if (!(URL.startsWith("http"))){
      URL = "https://"+URL.toString();
    }
  } catch(e){
    URL = "https://vdo.ninja/electron?version="+ver;
  }

  let currentTitle = "ElectronCapture";
  
  if (reuse){
    currentTitle = reuse;
  } else if (TITLE===null){
    counter+=1;
    currentTitle = "Electron "+(counter.toString());
  } else if (counter==0){
    counter+=1;
    currentTitle = TITLE.toString();
  } else {
    counter+=1;
    currentTitle = TITLE.toString() + " " +(counter.toString());
  }
  
	var ttt = (initialDisplay && initialDisplay.workAreaSize) || (getPrimaryDisplaySafe()?.workAreaSize) || screen.getPrimaryDisplay().workAreaSize;
  
	var targetWidth = WIDTH / factor;
	var targetHeight = HEIGHT / factor;
  
  var tainted = false;
  if (targetWidth > ttt.width){
    targetHeight = parseInt(targetHeight * ttt.width / targetWidth);
    targetWidth = ttt.width;
    tainted=true;
  }
  if (targetHeight > ttt.height){
    targetWidth = parseInt(targetWidth * ttt.height / targetHeight);
    targetHeight = ttt.height;
    tainted=true;
  }

	// Create the browser window.
	var mainWindow = new BrowserWindow({
		transparent: true,
		//focusable: false,
		width: targetWidth,
		height: targetHeight,
		resizable: true,
		frame: false,
		backgroundColor: '#0000',
		fullscreenable: true,
		titleBarStyle: 'hidden',
		roundedCorners: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			pageVisibility: true,
			partition: 'persist:abc',
			contextIsolation: !NODE,
			backgroundThrottling: false,
			webSecurity: webSecurity,
			nodeIntegrationInSubFrames: NODE,
			nodeIntegration: NODE  // this could be a security hazard, but useful for enabling screen sharing and global hotkeys
		},
		title: currentTitle
	});
	mainWindow.__immutableWebPreferences = desiredImmutableWebPreferences;
	mainWindow.__lastDisplayId = initialDisplay ? initialDisplay.id : null;
	updateGameCaptureState(mainWindow, {
		mode: normalizedModeForWindow || null,
		landingUrl: GAME_CAPTURE_SHELL_URL,
              pendingInviteUrl: pendingInviteUrl || null,
              activeInviteUrl: normalizedModeForWindow === 'game' ? null : originalUrlForWindow,
              lastInviteUrl: pendingInviteUrl || null,
              slotId: slotIdValue || null,
              preset: presetValue || null,
              cursorPreference: cursorPreferenceValue || null,
              appAudioTarget: appAudioTargetValue || null,
              transportPreference: transportPreferenceValue
      });
	attachShareProfileToWindow(mainWindow);
	if (normalizedModeForWindow === 'game') {
		pushGameCaptureUpdate(mainWindow, 'window-created');
	}
	
	mainWindow.webContents.session.webRequest.onHeadersReceived({ urls: [ "*://*/*" ] },
		(d, c)=>{
		  if(d.responseHeaders['X-Frame-Options']){
			delete d.responseHeaders['X-Frame-Options'];
		  } else if(d.responseHeaders['x-frame-options']) {
			delete d.responseHeaders['x-frame-options'];
		  }
		  c({cancel: false, responseHeaders: d.responseHeaders});
		}
	);
	
	//var appData = process.env.APPDATA+"\\..\\Local" || (process.platform == 'darwin' ? process.env.HOME + '/Library/Preferences' : process.env.HOME + "/.local/share")

	mainWindow.args = args; // storing settings
	if (args.windowName) {
		mainWindow.windowName = args.windowName;
		registerNamedWindowInstance(mainWindow, args.windowName);
	} else {
		mainWindow.windowName = null;
	}
	mainWindow.vdonVersion = false;
	mainWindow.PPTHotkey = false;
	
	if (UNCLICKABLE){
		mainWindow.mouseEvent = true;
		mainWindow.setIgnoreMouseEvents(mainWindow.mouseEvent);
	}
	
	ipcMain.on("vdonVersion", function(eventRet, arg) {  // this enables a PROMPT pop up , which is used to BLOCK the main thread until the user provides input. VDO.Ninja uses prompt for passwords, etc.
		if (mainWindow){
			mainWindow.vdonVersion = arg.ver || false;
		}
		console.log("arg vdonVersion:",arg);
	});
	
	
	ipcMain.on('PPTHotkey', function(eventRet, value) { // 
		console.log("updatePPT recieved 2:", value);
		if (!mainWindow){return;}
		
		if (mainWindow.PPTHotkey){
			try {
				if (globalShortcut.isRegistered(mainWindow.PPTHotkey)){
					globalShortcut.unregister(mainWindow.PPTHotkey);
				}
			} catch(e){
			}
		} 
		
		if (!value){
			mainWindow.PPTHotkey=false;
			return;
		}
		mainWindow.PPTHotkey = "";
		if (value.ctrl){
			mainWindow.PPTHotkey += "CommandOrControl";
		}
		if (value.alt){
			if (mainWindow.PPTHotkey){mainWindow.PPTHotkey+="+";}
			mainWindow.PPTHotkey += "Alt";
		}
		if (value.meta){
			if (mainWindow.PPTHotkey){mainWindow.PPTHotkey+="+";}
			mainWindow.PPTHotkey += "Meta";
		}
		if (value.key){
			if (mainWindow.PPTHotkey){mainWindow.PPTHotkey+="+";}		
			var matched = false;
			if (value.key === "+"){
				mainWindow.PPTHotkey += "Plus";
				matched = true;
			} else if (value.key === " "){
				mainWindow.PPTHotkey += "Space";
				matched = true;
			} else if (value.key.length === 1){
				mainWindow.PPTHotkey += value.key.toUpperCase();
				matched = true;
			} else {
				var possibleKeyCodes = ["Space","Backspace","Tab","Capslock","Return","Enter","Plus","Numlock","Scrolllock","Delete","Insert","Return","Up","Down","Left","Right","Home","End","PageUp","PageDown","Escape","Esc","VolumeUp","VolumeDown","VolumeMute","MediaNextTrack","MediaPreviousTrack","MediaStop","MediaPlayPause","PrintScreen","num0","num1","num2","num3","num4","num5","num6","num7","num8","num9","numdec","numadd","numsub","nummult","numdiv"];
				for (var i = 0;i<possibleKeyCodes.length;i++){
					if (possibleKeyCodes[i].toLowerCase() === value.key.toLowerCase()){
						mainWindow.PPTHotkey += possibleKeyCodes[i];
						matched = true;
						break;
					}
				}
			}
			if (!matched){
				 mainWindow.PPTHotkey += value.key.toUpperCase(); // last resort
			}
		} else {
			//console.log("Can't register just a control button; needs a key for global hotkeys");
			return;
		}
		console.log("mainWindow.PPTHotkey:"+mainWindow.PPTHotkey);
		const ret_ppt = globalShortcut.register(mainWindow.PPTHotkey, function(){
			if (mainWindow) {
				mainWindow.webContents.send('postMessage', {'PPT':true, "node":mainWindow.node})
			}
		});
		if (!ret_ppt) {
			//console.log('registration failed3')
		};
	});
	

	try {
		mainWindow.node = NODE;

		if ((X!=-1) || (Y!=-1)) {
			if (X==-1){X=0;}
			if (Y==-1){Y=0;}
			mainWindow.setPosition(Math.floor(X/factor), Math.floor(Y/factor))
		}
	} catch(e){console.error(e);}
	
	mainWindow.on('blur', () => {
		mainWindow.setBackgroundColor('#00000000'); // tmp fix for bug in e.js
		globalShortcut.unregister('Alt+Enter');
	});
	
	mainWindow.on('focus', () => {
		mainWindow.setBackgroundColor('#00000000'); // tmp fix for bug in e.js
		globalShortcut.register('Alt+Enter', () => {
			if (mainWindow && mainWindow.isFocused()) {
				if (process.platform == "darwin"){ // On certain electron builds, fullscreen fails on macOS; this is in case it starts happening again
					mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
				} else {
					if (mainWindow.full || mainWindow.isFullScreen()){
						mainWindow.full = false;
						mainWindow.setFullScreen(false);
					} else {
						mainWindow.full = true;
						mainWindow.setFullScreen(true);
					}
				}
			}
		});
	});
  
  
	mainWindow.webContents.on('will-prevent-unload', (event) => {
		const options = {
			type: 'question',
			buttons: ['Cancel', 'Leave'],
			message: 'Leave Site?',
			detail: 'This will end any active streams and may cause any recording that are in progress to be lost.',
		};
		const response = dialog.showMessageBoxSync(null, options)
		if (response === 1) event.preventDefault();
	});

	mainWindow.on('close', function(e) {
		e.preventDefault();
		if (!mainWindow || mainWindow.isDestroyed()) {
			return;
		}
		mainWindow.hide(); // hide, and wait 2 second before really closing; this allows for saving of files.
		if (global.closing){ // doesn't wait if we have issued a global app-wide closedown. speeds things up.
			return;
		}

		clearWindowCloseTimers(mainWindow);
		mainWindow.__pendingCloseRequested = true;

		const hangupTimeout = setTimeout(()=>{
			if (global.closing || !mainWindow || mainWindow.isDestroyed()){
				return;
			}
			try {
				mainWindow.webContents.send('postMessage', {'hangup':true}); // allows us to disable the director; useful for speed and preventing camera blinking/flickering after the window closes.
			} catch (error) {
				console.warn('Failed to send hangup before destroying window:', error);
			}
			const destroyTimeout = setTimeout(()=>{  // we wait for the camera to be disabled before closing; this is to avoid blinking and for file saving.
				if (global.closing || !mainWindow || mainWindow.isDestroyed()){
					return;
				}
				try{
					mainWindow.destroy();
				} catch(e){}
				mainWindow.__pendingDestroyTimeout = null;
				mainWindow.__pendingHangupTimeout = null;
				mainWindow.__pendingCloseRequested = false;
			}, 2000);
			mainWindow.__pendingDestroyTimeout = destroyTimeout;
		}, 0);

		mainWindow.__pendingHangupTimeout = hangupTimeout;
	});
	
	mainWindow.on('closed', function () { // Around line 1112
		console.log(`Window ID ${mainWindow ? mainWindow.id : 'unknown'} 'closed' event.`);
	});

	mainWindow.on("page-title-updated", function(event) {
		console.log("page-title-updated");
		event.preventDefault();
	});

	mainWindow.webContents.on("did-fail-load", function(e) {
		console.error("failed to load");
		console.error(e);
		//app.quit();
	});
	
	mainWindow.webContents.on('new-window', (event, url, frameName, disposition, options, additionalFeatures, referrer, postBody) => {
		console.log("new-window");
		mainWindow.webContents.mainFrame.frames.forEach(frame => {
			if (frame.url === referrer.url) {
				event.preventDefault();
				frame.executeJavaScript('(function () {\
					window.location = "'+url+'";\
				})();');
			} else if (frame.frames){
				frame.frames.forEach(subframe => {
					if (subframe.url === referrer.url) {
						event.preventDefault();
						subframe.executeJavaScript('(function () {\
							window.location = "'+url+'";\
						})();');
					} 
				})
			}
		});
	});
	
	
	
	mainWindow.webContents.session.on('will-download', (event, item, webContents) => {
		console.log("will-download");
	  if (mainWindow.webContents){
		var currentURL = mainWindow.webContents.getURL();
	  } else if (webContents.getURL){
		  var currentURL = webContents.getURL();
	  }
	  if (currentURL.includes("autorecord") || (args.savefolder!==null)){
		  var dir = args.savefolder;
		  if (!dir && (process.platform == 'darwin')){ //process.env.USERPROFILE
				dir = process.env.HOME + "/Downloads/";
		  } else if (!dir && (process.platform == 'win32')){ //process.env.USERPROFILE
				dir = process.env.USERPROFILE + "\\Downloads\\";
		  } else if (!dir && process.env.HOME){ //process.env.USERPROFILE
				dir = process.env.HOME + "/";
		  } else if (!dir && process.env.USERPROFILE){ //process.env.USERPROFILE
				dir = process.env.USERPROFILE + "/";
		  }
		  
		  if (dir!==null){
			console.log("Auto saving too "+dir + item.getFilename());
			item.setSavePath(dir + item.getFilename())
		  }
	  }
	});
		
	
	mainWindow.webContents.on('did-finish-load', function(e){
		console.log("did-finish-load");
		if (tainted){
			tainted=false;
		}
		if (mainWindow && mainWindow.webContents.getURL().includes('youtube.com')){
			console.log("Youtube ad skipper inserted");
			setInterval(function(mw){
				try {
					mw.webContents.executeJavaScript('\
						if (typeof xxxxxx == "undefined") {\
							var xxxxxx = setInterval(function(){\
							if (document.querySelector(".ytp-ad-skip-button")){\
								document.querySelector(".ytp-ad-skip-button").click();\
							}\
							},500);\
						}\
					');
				} catch(e){
					clearInterval(this);
					return;
				}
			},5000, mainWindow);
		}
		
		if (JSCONTENT && mainWindow && mainWindow.webContents){
		  try {
			// Wrap the JS content in an IIFE to avoid global scope pollution
			const safeJS = `
			  (function() {
				try {
				  ${JSCONTENT}
				} catch(e) {
				  console.error('Error in injected JavaScript:', e);
				}
			  })();
			`;
			mainWindow.webContents.executeJavaScript(safeJS);
			console.log("Injecting specified JavaScript contained in the file");
		  } catch(e){
			console.log('Error preparing JS injection:', e);
		  }
		}
		
		if (CSSCONTENT && mainWindow && mainWindow.webContents){
			try {
				mainWindow.webContents.insertCSS(CSSCONTENT, {cssOrigin: 'user'});
				console.log("Inserting specified CSS contained in the file");
			} catch(e){
				console.log(e);
			}
		}

		try {
			const currentUrl = mainWindow.webContents.getURL();
			if (currentUrl && currentUrl.startsWith('file://') && currentUrl.includes('gamecapture.html')) {
				pushGameCaptureUpdate(mainWindow, 'shell-loaded');
			}
		} catch (stateError) {
			console.warn('Unable to emit gamecapture state after navigation:', stateError);
		}
		
		//
	});
	
	//ipcMain.on('postMessage', (msg) => {
	//    console.log('We received a postMessage from the preload script')
	//})

	ipcMain.on('getAppVersion', function(eventRet) {
		try{
			if (mainWindow) {
				mainWindow.webContents.send('appVersion', app.getVersion());
			}
		} catch(e){console.error(e);}
	});
	
	if (mainWindow){
		const ret = globalShortcut.register('CommandOrControl+M', () => {
			console.log('CommandOrControl+M is pressed')
			if (mainWindow.node && mainWindow.vdonVersion){
				mainWindow.webContents.send('postMessage', {'micOld':'toggle'})
			} else if (mainWindow && mainWindow.vdonVersion) {
				mainWindow.webContents.send('postMessage', {'mic':'toggle'})
			}
		});
		if (!ret) {
			console.log('registration failed1')
		}
	}
	
	const ret_refresh = globalShortcut.register('CommandOrControl+Shift+Alt+R', () => {
		console.log('CommandOrControl+Shift+Alt+R')
		if (mainWindow) {
			mainWindow.reload();
		}
	});
	if (!ret_refresh) {
		console.log('registration failed2')
	}
	
	
	
	const socialstream = globalShortcut.register('CommandOrControl+Shift+Alt+X', () => {
		console.log('CommandOrControl+Shift+Alt+X')
		if (mainWindow) {
			if (mainWindow.mouseEvent){
				mainWindow.mouseEvent = false;
				mainWindow.setIgnoreMouseEvents(mainWindow.mouseEvent);
				mainWindow.show()
				
				if (!mainWindow.args.pin){
					mainWindow.setAlwaysOnTop(false);
				}
			} else {
				mainWindow.mouseEvent = true;
				mainWindow.setIgnoreMouseEvents(mainWindow.mouseEvent);
				
				if (process.platform == 'darwin'){
					mainWindow.setAlwaysOnTop(true, "floating", 1)
				} else {
					mainWindow.setAlwaysOnTop(true, "level");
				}
			}
		}
	});
	if (!socialstream) {
		console.log('registration failed3')
	}
	
	// "CommandOrControl+Shift+X
	
	try {
		if (PIN == true) {
			// "floating" + 1 is higher than all regular windows, but still behind things
			// like spotlight or the screen saver
			mainWindow.setAlwaysOnTop(true, "level");
			// allows the window to show over a fullscreen window
			mainWindow.setVisibleOnAllWorkspaces(true);
		} else {
			mainWindow.setAlwaysOnTop(false);
			// allows the window to show over a fullscreen window
			mainWindow.setVisibleOnAllWorkspaces(false);
		}

		if (reuse){
			if (FULLSCREEN){
				 if (process.platform == "darwin"){
					mainWindow.maximize();
				 } else {
					mainWindow.setFullScreen(true);
				 }
			}
		} else if (FULLSCREEN){
			 if (process.platform == "darwin"){
				mainWindow.maximize();
			 } else {
				mainWindow.setFullScreen(true);
			 }
		}

		if (process.platform == "darwin"){
			try { // MacOS
				app.dock.hide();
			} catch (e){
				// Windows?
			}
		}

		
	} catch(e){console.error(e);}
	
	
	
	mainWindow.once('ready-to-show', () => {
		console.log("ready to show");
        if (MINIMIZED){
            mainWindow.minimize();
		//+ KravchenkoAndrey 08.01.2022
        } else if (UNCLICKABLE){
            mainWindow.showInactive();
		//- KravchenkoAndrey 08.01.2022
        } else {
            mainWindow.show();
        }
		if (mainWindow && mainWindow.isFocused()) {
			globalShortcut.register('Alt+Enter', () => {
				console.log("PRESSED")
				if (process.platform == "darwin"){ // On certain electron builds, fullscreen fails on macOS; this is in case it starts happening again
					mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
				} else {
					console.log("mainWindow.isFullScreen(): ",mainWindow.isFullScreen());
					
					if (mainWindow.full || mainWindow.isFullScreen()){
						mainWindow.full = false;
						mainWindow.setFullScreen(false);
					} else {
						mainWindow.full = true;
						mainWindow.setFullScreen(true);
					}
				}
			});
		}
    });
	
  try {
    var HTML = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" /><style>body {padding:0;height:100%;width:100%;margin:0;}</style></head><body><div style="-webkit-app-region: drag;height:25px;width:100%"></div></body></html>';
    mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURI(HTML));
  } catch(e){
    console.error(e);
  }
  
  // Load the actual URL
  try {
    mainWindow.loadURL(URL);
  } catch (e){
    console.error(e);
  }
	
	
	try {
		
		mainWindow.webContents.on('dom-ready', async (event)=> {
			console.log('dom-ready');

			if (mainWindow.args.hidecursor){
				mainWindow.webContents.insertCSS(`
				  * {
					cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), none !important;
					user-select: none!important;
				  }
				  :root {
					  --electron-drag-fix: none!important;
					  
				  }
				`);
			}
		});
	} catch (e){
		console.error(e);
		//app.quit();
  	}
	
}
contextMenu({
	prepend: (defaultActions, params, browserWindow) => [
		{
			label: '🏠 Go to Homepage',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				
				DoNotClose = true;
				var ver = app.getVersion();
				var args = browserWindow.args; // reloading doesn't work otherwise
				args.url = "https://vdo.ninja/electron?version="+ver;
				var title = browserWindow.getTitle();
				browserWindow.destroy();
				createWindow(args, title); // we close the window and open it again; a faked refresh
				DoNotClose = false;
				
			}
		},
		{
			label: '🔙 Go Back',
			// Only show it when right-clicking text
			visible: browserWindow.webContents.canGoBack(),
			click: () => {
				//var args = browserWindow.args; // reloading doesn't work otherwise
				//args.url = "https://vdo.ninja/electron?version="+ver;
				//browserWindow.destroy();
				//createWindow(args); // we close the window and open it again; a faked refresh
				//DoNotClose = false;
				browserWindow.webContents.goBack();
			}
		},
		{
			label: '♻ Reload (Ctrl+Shift+Alt+R)',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				
				browserWindow.reload();
				
				/* DoNotClose = true; // avoids fully closing the app if no other windows are open
				
				var args = browserWindow.args; // reloading doesn't work otherwise
				args.url = browserWindow.webContents.getURL();
				var title = browserWindow.getTitle();
				browserWindow.destroy();
				createWindow(args, title); // we close the window and open it again; a faked refresh
				DoNotClose = false; */
			}
		},
		{
			label: '✖️ Open New Window',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				var ver = app.getVersion();
				var args = browserWindow.args;
				args.url = "https://vdo.ninja/electron?version="+ver;
				createWindow(args);
			}
		},
		{
			label: '⚠️ Elevate Privilege',
			// Only show it when right-clicking text

			visible: !browserWindow.node,
			click: () => {
				let options  = {
					 title : "Elevate the Allowed Privileges of websites",
					 buttons: ["Yes","Cancel"],
					 message: "This will reload the current page, allowing for screen-share, global-hotkeys, and message prompts.\n\nIt will however also decrease app-security, especially if on an untrusted website.\n\nContinue?"
				};
				let response = dialog.showMessageBoxSync(options);
				if (response==0){
					//var URL = browserWindow.webContents.getURL();
					DoNotClose = true; // avoids fully closing the app if no other windows are open
					//console.log(browserWindow.node);
					var args = browserWindow.args;
					args.url = browserWindow.webContents.getURL();
					args.node = !browserWindow.node;
					var title = browserWindow.getTitle();
					browserWindow.destroy();
					createWindow(args, title); // we close the window and open it again; a faked refresh
					DoNotClose = false;
				}
			}
		},
		/////////////
		{
			label: '🎶 Change media device',
			// Only show it when right-clicking text
			visible: true,
			type: 'submenu',
			submenu: [
				{
					label: "🔈 Change audio destination for THIS element only",
					// Only show it when right-clicking text

					visible: params.mediaType == "video" || params.mediaType == "audio" || false,
					click: () => {
						var buttons = ["Cancel"];
						var details = [false];
						
						
						// browserWindow.inspectElement(params.x, params.y)
						browserWindow.webContents.send('postMessage', {'getDeviceList':true, 'params':params});
						
						ipcMain.once('deviceList', (event, data) => {
							console.log(data);
							var deviceList = data.deviceInfos;
							
							//data.menu = menu || false;
							//data.eleId = ele.id || false;
							//data.UUID = ele.dataset.UUID || false;
							//data.deviceInfos;
							//data.params = params;
							
							for (var i=0;i<deviceList.length;i++){
								if (deviceList[i].kind === "audiooutput"){
									buttons.push(deviceList[i].label);
									details.push(deviceList[i].deviceId);
								}
							}
							let options  = {
								title : "Change audio output device",
								buttons: buttons,
								message: "Change audio output specifically for this media element"
							};
							
							let response = dialog.showMessageBoxSync(options);
							if (response){
								browserWindow.webContents.send('postMessage', {'changeAudioOutputDevice':details[response], data:data});
							}
								
						});
					}
				},
				{
					label: '🔈 Change audio destination',
					// Only show it when right-clicking text

					visible: true, //browserWindow.node,
					click: () => {
						var buttons = ["Cancel"];
						var details = [false];
						
						// browserWindow.inspectElement(params.x, params.y)
						browserWindow.webContents.send('postMessage', {'getDeviceList':true, 'params':params});
						
						ipcMain.once('deviceList', (event, data) => {
							console.log(data);
							var deviceList = data.deviceInfos;
							
							//data.menu = menu || false;
							//data.eleId = ele.id || false;
							//data.UUID = ele.dataset.UUID || false;
							//data.deviceInfos;
							//data.params = params;
							
							for (var i=0;i<deviceList.length;i++){
								if (deviceList[i].kind === "audiooutput"){
									buttons.push(deviceList[i].label);
									details.push(deviceList[i].deviceId);
								}
							}
							let options  = {
								title : "Change audio output device",
								buttons: buttons,
								message: "Change the audio output device"
							};
							
							let response = dialog.showMessageBoxSync(options);
							if (response){
								browserWindow.webContents.send('postMessage', {'changeAudioOutputDevice':details[response]});
							}
								
						});
						
						
					}
				},
				{
					label: '🎤 Change audio input [Requires Elevated Privileges]',
					visible: !browserWindow.vdonVersion && !browserWindow.node,//!browserWindow.node,
					click: () => {
						let options  = {
							 title : "Elevate the Allowed Privileges of websites",
							 buttons: ["Yes","Cancel"],
							 message: "This will reload the current page, allowing for screen-share, global-hotkeys, and message prompts.\n\nIt will however also decrease app-security, especially if on an untrusted website.\n\nContinue?"
						};
						let response = dialog.showMessageBoxSync(options);
						if (response==0){
							//var URL = browserWindow.webContents.getURL();
							DoNotClose = true; // avoids fully closing the app if no other windows are open
							//console.log(browserWindow.node);
							var args = browserWindow.args;
							args.url = browserWindow.webContents.getURL();
							args.node = !browserWindow.node;
							var title = browserWindow.getTitle();
							browserWindow.destroy();
							createWindow(args, title);
							DoNotClose = false;
						}
					}
				},
				{
					label: '🎤 Change audio input',
					// Only show it when right-clicking text

					visible: browserWindow.vdonVersion, //browserWindow.node,
					click: () => {
						var buttons = ["Cancel"];
						var details = [false];
						
						browserWindow.webContents.send('postMessage', {'getDeviceList':true, 'params':params});
						
						ipcMain.once('deviceList', (event, data) => {
							console.log(data);
							var deviceList = data.deviceInfos;
							
							//data.menu = menu || false;
							//data.eleId = ele.id || false;
							//data.UUID = ele.dataset.UUID || false;
							//data.deviceInfos;
							//data.params = params;
							
							var deviceCounter = 0;
							for (var i=0;i<deviceList.length;i++){
								if (deviceList[i].kind === "audioinput"){
									deviceCounter +=1;
									buttons.push(deviceList[i].label);
									details.push(deviceList[i].deviceId);
								}
							}
							
							let options  = { 
								 title : "Change audio input device",
								 buttons: buttons,
								 message: "Change your local audio input source"
							};
						
						
							if (!deviceCounter){
								options.message = "No audio input devices available here";
							};
							
							
							let response = dialog.showMessageBoxSync(options);
							if (response){
								browserWindow.webContents.send('postMessage', {'changeAudioDevice':details[response]});
							}
						})
					}
				},
				{
					label: '🎥 Change video input [Requires Elevated Privileges]',
					visible: !browserWindow.vdonVersion && !browserWindow.node,//!browserWindow.node,
					click: () => {
						let options  = {
							 title : "Elevate the Allowed Privileges of websites",
							 buttons: ["Yes","Cancel"],
							 message: "This will reload the current page, allowing for screen-share, global-hotkeys, and message prompts.\n\nIt will however also decrease app-security, especially if on an untrusted website.\n\nContinue?"
						};
						let response = dialog.showMessageBoxSync(options);
						if (response==0){
							//var URL = browserWindow.webContents.getURL();
							DoNotClose = true; // avoids fully closing the app if no other windows are open
							//console.log(browserWindow.node);
							var args = browserWindow.args;
							args.url = browserWindow.webContents.getURL();
							args.node = !browserWindow.node;
							var title = browserWindow.getTitle();
							browserWindow.destroy();
							createWindow(args, title);
							DoNotClose = false;
						}
					}
				},
				{
					label: '🎥 Change video input',
					// Only show it when right-clicking text

					visible: browserWindow.vdonVersion, //browserWindow.node,
					click: () => {
						var buttons = ["Cancel"];
						var details = [false];
						
						browserWindow.webContents.send('postMessage', {'getDeviceList':true, 'params':params});
						
						ipcMain.once('deviceList', (event, data) => {
							console.log(data);
							var deviceList = data.deviceInfos;
							
							//data.menu = menu || false;
							//data.eleId = ele.id || false;
							//data.UUID = ele.dataset.UUID || false;
							//data.deviceInfos;
							//data.params = params;
							var deviceCounter = 0;
							for (var i=0;i<deviceList.length;i++){
								if (deviceList[i].kind === "videoinput"){
									deviceCounter+=1;
									buttons.push(deviceList[i].label);
									details.push(deviceList[i].deviceId);
								}
							}
							let options  = {
								 title : "Change video input device",
								 buttons: buttons,
								 message: "Change your local camera source"
							};
						
						
							if (!deviceCounter){
								options.message = "No video devices available here";
							};
							
							let response = dialog.showMessageBoxSync(options);
							if (response){
								browserWindow.webContents.send('postMessage', {'changeVideoDevice':details[response]});
							}
						})
					}
				}
			]
		},
		{
			label: '🧰 Enable Chrome Extension',
			// Only show it when right-clicking text

			visible: extensions.length,
			click: () => {
				var buttons = ["Cancel"];
				
				for (var i=0;i<extensions.length;i++){
					buttons.push(extensions[i].name);
				}
				var options  = {
					 title : "Choose an extension to enable",
					 buttons: buttons,
					 message: "Choose an extension to enable. You may need to reload the window to trigger once loaded."
				};
			
			
				let idx = dialog.showMessageBoxSync(options);
				if (idx){
					idx -= 1;
					console.log(idx, extensions[idx].location);
					
					browserWindow.webContents.session.loadExtension(extensions[idx].location+"").then(({ id }) => {
						console.log("loadExtension");
					});
					// extensions
				}
			}
		},
		{
			label: '🔇 Mute the window',
			type: 'checkbox',
			visible: true,
			checked: browserWindow.webContents.isAudioMuted(),
			click: () => {
				if (browserWindow.webContents.isAudioMuted()) {
					browserWindow.webContents.setAudioMuted(false);
				} else {
					browserWindow.webContents.setAudioMuted(true);
				}

			}
		},
		{
			label: '🔴 Record Video (toggle)',
			// Only show it when right-clicking text
			visible: (browserWindow.vdonVersion && params.mediaType == "video") || false,
			click: () => {
				if (browserWindow){
					browserWindow.webContents.send('postMessage', {'record':true, 'params':params});
				}
			}
		},
		{
			label: '✏️ Edit URL', 
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				var URL = browserWindow.webContents.getURL();
				var onTop = browserWindow.isAlwaysOnTop();
				if (onTop) {
					browserWindow.setAlwaysOnTop(false);
				}
				prompt({
					title: 'Edit the URL',
					label: 'URL:',
					value: URL,
					inputAttrs: {
						type: 'url'
					},
					resizable: true,
					type: 'input',
					alwaysOnTop: true
				})
				.then((r) => {
					if(r === null) {
						console.log('user cancelled');
						  if (onTop) {
							browserWindow.setAlwaysOnTop(true);
						  }
					} else {
						console.log('result', r);
						try {
							browserWindow.loadURL(formatURL(r));
						} catch(e){
							console.error(e);
						}
						if (onTop) {
							browserWindow.setAlwaysOnTop(true);
						}
						console.log(browserWindow);
						console.log(formatURL(r));
						
						// var args = browserWindow.args; // reloading doesn't work otherwise
						// args.url = r;
						// var title = browserWindow.getTitle();
						
						// var size = browserWindow.getSize();
						// args.width = size[0];
						// args.height = size[1];
						
						// if (process.platform !== "darwin"){
							// args.fullscreen = browserWindow.isFullScreen();
						// } else {
							// args.fullscreen = browserWindow.isMaximized();
						// }
						
						// args.fullscreen = true;
						
						// browserWindow.destroy();
						// createWindow(args, title); // we close the window and open it again; a faked refresh
						// DoNotClose = false;
						
					}
				})
				.catch(console.error);
			}
		},
		{
			label: '🪟 IFrame Options',
			// Only show it when right-clicking text
			visible: params.frameURL,
			type: 'submenu',
			submenu: [{
				label: '✏️ Edit IFrame URL',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					console.log(browserWindow.webContents);
					console.log(params);
					
					var URL = params.frameURL;
					var onTop = browserWindow.isAlwaysOnTop();
					if (onTop) {
						browserWindow.setAlwaysOnTop(false);
					}
					prompt({
						title: 'Edit the target IFrame URL',
						label: 'URL:',
						value: URL,
						inputAttrs: {
							type: 'url'
						},
						resizable: true,
						type: 'input',
						alwaysOnTop: true
					})
					.then((r) => {
						if(r === null) {
							console.log('user cancelled');
							  if (onTop) {
								browserWindow.setAlwaysOnTop(true);
							  }
						} else {
							console.log('result', r);
							if (onTop) {
								browserWindow.setAlwaysOnTop(true);
							}
							
							browserWindow.webContents.executeJavaScript('(function () {\
								var ele = document.elementFromPoint('+params.x+', '+params.y+');\
								if (ele.tagName !== "IFRAME"){\
									ele = false;\
									document.querySelectorAll("iframe").forEach(ee=>{\
										if (ee.src == "'+URL+'"){\
											ele = ee;\
										}\
									});\
								}\
								if (ele && (ele.tagName == "IFRAME")){\
									ele.src = "'+r+'";\
								}\
							})();');
							
						}
					})
					.catch(console.error);
				}
			},{
				label: '♻ Reload IFrame',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					browserWindow.webContents.mainFrame.frames.forEach(frame => {
					  if (frame.url === params.frameURL) {
						frame.reload();
					  }
					});
				}
			},{
				label: '🔙 Go Back in IFrame',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					browserWindow.webContents.mainFrame.frames.forEach(frame => {
					  if (frame.url === params.frameURL) {
						frame.executeJavaScript('(function () {window.history.back();})();');
					  }
					});
				}
			},{
				label: 'Go Forward in IFrame',
				// Only show it when right-clicking text
				visible: true,
				click: () => {
					browserWindow.webContents.mainFrame.frames.forEach(frame => {
					  if (frame.url === params.frameURL) {
						frame.executeJavaScript('(function () {window.history.forward();})();');
					  }
					});
				}
			}]
		},
	  {
		label: '📑 Insert CSS',
		// Only show it when right-clicking text
		visible: true,
		click: async () => {
		  var onTop = browserWindow.isAlwaysOnTop();
		  if (onTop) {
			browserWindow.setAlwaysOnTop(false);
		  }
		  const savedValue = await browserWindow.webContents.executeJavaScript(`localStorage.getItem('insertCSS');`);
		  
		  console.log(savedValue);
		  prompt({
			title: 'Insert Custom CSS',
			label: 'CSS:',
			value: savedValue || "body {background-color:#0000;}",
			inputAttrs: {
			  type: 'text'
			},
			resizable: true,
			type: 'input',
			alwaysOnTop: true
		  })
		  .then((r) => {
			if(r === null) {
			  console.log('user cancelled');
			  if (onTop) {
				browserWindow.setAlwaysOnTop(true);
			  }
			} else {
			  console.log('result', r);
			  browserWindow.webContents.executeJavaScript(`localStorage.setItem('insertCSS', '${r}');`);
			  if (onTop) {
				browserWindow.setAlwaysOnTop(true);
			  }
			  browserWindow.webContents.insertCSS(r, {cssOrigin: 'user'});
			}
		  })
		  .catch(console.error);
		}
	  },
		{
		  label: '📝 Insert JavaScript',
		  visible: true,
		  click: async () => {
			var onTop = browserWindow.isAlwaysOnTop();
			if (onTop) {
			  browserWindow.setAlwaysOnTop(false);
			}
			const savedValue = await browserWindow.webContents.executeJavaScript(`localStorage.getItem('insertJS');`);
			
			prompt({
			  title: 'Insert Custom JavaScript',
			  label: 'JavaScript:',
			  value: savedValue || "console.log('Custom JavaScript loaded');",
			  inputAttrs: {
				type: 'text'
			  },
			  resizable: true,
			  type: 'input',
			  alwaysOnTop: true
			})
			.then((r) => {
			  if(r === null) {
				console.log('user cancelled');
				if (onTop) {
				  browserWindow.setAlwaysOnTop(true);
				}
			  } else {
				console.log('result', r);
				browserWindow.webContents.executeJavaScript(`
				  localStorage.setItem('insertJS', ${JSON.stringify(r)});
				`);
				if (onTop) {
				  browserWindow.setAlwaysOnTop(true);
				}
				browserWindow.webContents.executeJavaScript(r);
			  }
			})
			.catch(console.error);
		  }
		},
		{
			label: '✏️ Edit Window Title',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				var title2 = browserWindow.getTitle();
				var onTop = browserWindow.isAlwaysOnTop();
				if (onTop) {
					browserWindow.setAlwaysOnTop(false);
				}
				prompt({
					title: 'Edit  Window Title',
					label: 'Title:',
					value: title2,
					inputAttrs: {
							type: 'string'
					},
					resizable: true,
					type: 'input',
					alwaysOnTop: true
				}).then((r) => {
					if(r === null) {
						if (onTop) {
						  browserWindow.setAlwaysOnTop(true);
						}
						console.log('user cancelled');
					} else {
						if (onTop) {
							browserWindow.setAlwaysOnTop(true);
						}
						console.log('result', r);
						browserWindow.args.title = r;
						browserWindow.setTitle(r);
					}
				})
				.catch(console.error);
			}
		},
		{
			label: '↔️ Resize window',
			// Only show it when right-clicking text
			visible: true,
			type: 'submenu',
			submenu: [
				{
					label: 'Fullscreen (alt+tab)',
					// Only show if not already full-screen
					visible: !browserWindow.isMaximized(),
					click: () => {
						if (process.platform == "darwin"){ // On certain electron builds, fullscreen fails on macOS; this is in case it starts happening again
							browserWindow.isMaximized() ? browserWindow.unmaximize() : browserWindow.maximize();
						} else {
							if (browserWindow.full || browserWindow.isFullScreen()){
								browserWindow.full = false;
								browserWindow.setFullScreen(false);
							} else {
								browserWindow.full = true;
								browserWindow.setFullScreen(true);
							}
						}
						
						//browserWindow.setMenu(null);
						//const {width,height} = screen.getPrimaryDisplay().workAreaSize;
						//browserWindow.setSize(width, height);
					}
				},
				{
					label: '1920x1080',
					// Only show it when right-clicking text
					visible: true,
					click: () => {
						if (process.platform !== "darwin"){
							if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
						} else {
							if (browserWindow.isMaximized()){browserWindow.unmaximize();}
						}
						//let factor = screen.getPrimaryDisplay().scaleFactor;
						//browserWindow.setSize(1920/factor, 1080/factor);
						let point =  screen.getCursorScreenPoint();
						let factor = screen.getDisplayNearestPoint(point).scaleFactor || 1;
						browserWindow.setSize(parseInt(1920/factor), parseInt(1080/factor));
						browserWindow.full = false;
					}
				},
				{
					label: '1280x720',
					// Only show it when right-clicking text
					visible: true,
					click: () => {
						if (process.platform !== "darwin"){
							if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
						} else {
							if (browserWindow.isMaximized()){browserWindow.unmaximize();}
						}	
						let point =  screen.getCursorScreenPoint();
						let factor = screen.getDisplayNearestPoint(point).scaleFactor || 1;
						browserWindow.setSize(parseInt(1280/factor), parseInt(720/factor));
						browserWindow.full = false;
					}
				},
				{
					label: '640x360',
					// Only show it when right-clicking text
					visible: true,
					click: () => {
						if (process.platform !== "darwin"){
							if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
						} else {
							if (browserWindow.isMaximized()){browserWindow.unmaximize();}
						}
						let point =  screen.getCursorScreenPoint();
						let factor = screen.getDisplayNearestPoint(point).scaleFactor || 1;
						browserWindow.setSize(parseInt(640/factor), parseInt(360/factor));
						browserWindow.full = false;
					}
				},
				{
					label: 'Custom resolution',
					// Only show it when right-clicking text
					visible: true,
					click: () => {
						var URL = browserWindow.webContents.getURL();
						var onTop = browserWindow.isAlwaysOnTop();
						if (onTop) {
							browserWindow.setAlwaysOnTop(false);
						}
						
						prompt({
							title: 'Custom window resolution',
							label: 'Enter a resolution:',
							value: browserWindow.getSize()[0] + 'x' + browserWindow.getSize()[1],
							inputAttrs: {
								type: 'string',
								placeholder: '1280x720'
							},
							type: 'input',
							alwaysOnTop: true
						})
						.then((r) => {
							if(r === null) {
								console.log('user cancelled');
								if (onTop) {
									browserWindow.setAlwaysOnTop(true);
								}
							} else {
								console.log('Window resized to ', r);
								browserWindow.full = false;
								if (onTop) {
									browserWindow.setAlwaysOnTop(true);
								}
								if (process.platform !== "darwin"){
									if (browserWindow.isFullScreen()){browserWindow.setFullScreen(false);}
								} else {
									if (browserWindow.isMaximized()){browserWindow.unmaximize();}
								}	
								let point =  screen.getCursorScreenPoint();
								let factor = screen.getDisplayNearestPoint(point).scaleFactor || 1;
								console.log(r);
								console.log(factor);
								browserWindow.setSize(parseInt(r.split('x')[0]/factor), parseInt(r.split('x')[1]/factor));
							}
						})
						.catch(console.error);
					}
				}
			]
		},
		{
			label: '🚿 Clean Video Output',
			type: 'checkbox',
			visible: (!browserWindow.webContents.getURL().includes('vdo.ninja') && !browserWindow.webContents.getURL().includes('invite.cam')),
			checked: false,
			click: () => {
				var css = " \
					.html5-video-player {\
						z-index:unset!important;\
					}\
					.html5-video-container {	\
						z-index:unset!important;\
					}\
					video { \
						width: 100vw!important;height: 100vh!important;  \
						left: 0px!important;    \
						object-fit: cover!important;\
						top: 0px!important;\
						overflow:hidden;\
						z-index: 2147483647!important;\
						position: fixed!important;\
					}\
					body {\
						overflow: hidden!important;\
					}";
				browserWindow.webContents.insertCSS(css, {cssOrigin: 'user'});
				browserWindow.webContents.executeJavaScript('(function () {\
					var videos = document.querySelectorAll("video");\
					if (videos.length>1){\
						var video = videos[0];\
						for (var i=1;i<videos.length;i++){\
							if (!video.videoWidth){\
								video = videos[i];\
							} else if (videos[i].videoWidth && (videos[i].videoWidth>video.videoWidth)){\
								video = videos[i];\
							}\
						}\
						document.body.appendChild(video);\
					} else if (videos.length){\
						document.body.appendChild(videos[0]);\
					}\
				})();');
				
				if (browserWindow.webContents.getURL().includes('youtube.com')){
					browserWindow.webContents.executeJavaScript('(function () {\
						if (!xxxxxx){\
							var xxxxxx = setInterval(function(){\
							if (document.querySelector(".ytp-ad-skip-button")){\
								document.querySelector(".ytp-ad-skip-button").click();\
							}\
							},500);\
						}\
					})();');
				}
			}
		},
		{
			label: '🖱️ Hide cursor',
			type: 'checkbox',
			visible: true,
			checked: browserWindow.args.hidecursor || false,
			click: () => { 
				browserWindow.args.hidecursor = !browserWindow.args.hidecursor || false;
				if (browserWindow.args.hidecursor){
					browserWindow.webContents.insertCSS(`
					  * {
						cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), none !important;
						user-select: none!important;
					  }
					  :root {
						  --electron-drag-fix: none!important;
						  
					  }
					`);
				} else {
					browserWindow.webContents.insertCSS(`
					  * {
						cursor: auto!important;
					  }
					  :root {
						  --electron-drag-fix: drag!important;
						  
					  }
					`);
				}
			}
		},
		{
			label: '📌 Always on top',
			type: 'checkbox',
			visible: true,
			checked: browserWindow.isAlwaysOnTop(),
			click: () => {
				if (browserWindow.isAlwaysOnTop()) {
					browserWindow.setAlwaysOnTop(false);
					browserWindow.args.pin = false;
					browserWindow.setVisibleOnAllWorkspaces(false);
				} else {
					browserWindow.args.pin = true;
					if (process.platform == 'darwin'){
						browserWindow.setAlwaysOnTop(true, "floating", 1)
					} else {
						browserWindow.setAlwaysOnTop(true, "level");
					}
					
					browserWindow.setVisibleOnAllWorkspaces(true);
				}
			}
		},
		{
			label: '🚫🖱️ Make UnClickable until in-focus or CTRL+SHIFT+ALT+X',
			visible: true, // Only show it when pinned
			click: () => {
				if (browserWindow){
					if (!browserWindow.isAlwaysOnTop()) {
						if (process.platform == 'darwin'){
							browserWindow.setAlwaysOnTop(true, "floating", 1)
						} else {
							browserWindow.setAlwaysOnTop(true, "level");
						}
						browserWindow.setVisibleOnAllWorkspaces(true);
					}
					browserWindow.mouseEvent = true;
					browserWindow.setIgnoreMouseEvents(browserWindow.mouseEvent);
				}
			}
		},
		{
			label: 'Force 16/9 aspect ratio',
			type: 'checkbox',
			visible: false, // need to re-ensable this at some point
			checked: forcingAspectRatio,
			click: () => {
				if (forcingAspectRatio) {
					browserWindow.setAspectRatio(0)
					forcingAspectRatio = false
				} else {
					browserWindow.setAspectRatio(16/9)
					forcingAspectRatio = true
				}

			}
		},
		{
			label: '🔍 Inspect Element',
			visible: true,
			click: () => {
				browserWindow.inspectElement(params.x, params.y)
			}
		},
		{
			label: '❌ Close',
			// Only show it when right-clicking text
			visible: true,
			click: () => {
				browserWindow.close() // hide, and wait 2 second before really closing; this allows for saving of files.
			}
		}
	]
});

/* app.on('second-instance', (event, commandLine, workingDirectory, argv2) => {
	createWindow(argv2, argv2.title); // works, but not with deeplinks for example
}); */

app.on('second-instance', (event, commandLine, workingDirectory, argv2) => {
    console.log('Second instance launched with args:', commandLine);
	const windowSummaries = BrowserWindow.getAllWindows().map((win) => {
		try {
			return {
				id: win.id,
				title: win.getTitle(),
				name: win.windowName || win.__namedWindowKey || null,
				isDestroyed: win.isDestroyed(),
				isVisible: win.isVisible(),
				isMinimized: win.isMinimized(),
				bounds: win.getBounds()
			};
		} catch (error) {
			return { id: win.id, error: error.message };
		}
	});
	console.log('Existing windows at second-instance start:', windowSummaries);
    
    // Check for deep link first
    const deepLinkUrl = commandLine.find(arg => arg.startsWith('electroncapture://'));
    if (deepLinkUrl) {
        console.log('Processing deep link:', deepLinkUrl);
        const args = parseDeepLink(deepLinkUrl);
        if (args) {
            if (handleGameCaptureDeepLink(args, 'second-instance')) {
                return;
            }
            createWindow(args);
            return;
        }
    }

    const windowConfig = {
        ...Argv,  // Start with default arguments
        ...argv2, // Override with new arguments
        width: argv2.w || argv2.width || Argv.width,
        height: argv2.h || argv2 || Argv.height,
        x: typeof argv2.x !== 'undefined' ? argv2.x : Argv.x,
        y: typeof argv2.y !== 'undefined' ? argv2.y : Argv.y
    };

    console.log('Creating window with config:', windowConfig);
    createWindow(windowConfig, windowConfig.title);
});

// macOS deep linking support
app.on('open-url', (event, url) => {
    event.preventDefault();
    console.log('Received open-url event:', url);
    if (url.startsWith('electroncapture://')) {
        const args = parseDeepLink(url);
        if (args) {
            if (handleGameCaptureDeepLink(args, 'open-url')) {
                return;
            }
            // Ensure app is ready before creating window
            if (app.isReady()) {
                console.log('Creating window from deep link with args:', args);
                createWindow(args);
            } else {
                app.on('ready', () => {
                    console.log('App ready, creating window from deep link with args:', args);
                    createWindow(args);
                });
            }
        }
    }
});

var DoNotClose = false;
app.on('window-all-closed', () => {
  if (DoNotClose){ // Your existing DoNotClose logic
    //console.log("DO NOT CLOSE!");
    return;
  }
  console.log("'window-all-closed': All windows are closed. Unregistering all shortcuts and quitting.");
  globalShortcut.unregisterAll();
  app.quit();
});

var closing = 0;

app.on('before-quit', (event) => {
  console.log("Application 'before-quit' event triggered.");
  if (!BrowserWindow.getAllWindows().length) {
    console.log("'before-quit': No windows open, quitting normally.");
    return; // No need to preventDefault or delay if no windows.
  }

  // The 'closing' variable logic is from your original code.
  if (global.closing !== 2) { // Assuming 'closing' is a global or appropriately scoped variable
    global.closing = 1;
    console.log("'before-quit': Preventing immediate quit to process windows.");
    event.preventDefault(); // Prevent immediate quit

    BrowserWindow.getAllWindows().forEach((bw) => {
      if (bw && !bw.isDestroyed()) {
        console.log(`'before-quit': Processing window ID ${bw.id}.`);
        bw.hide();
        if (bw.webContents && !bw.webContents.isDestroyed()) {
          bw.webContents.send('postMessage', {'hangup':true});
        }
        // Note: The window's own 5-second destroy timer (from its 'close' event)
        // might be initiated if bw.close() was called, but here we are directly
        // hiding and sending hangup. The app's 1.6s quit timer will likely take precedence.
      }
    });

    setTimeout(() => {
      console.log("'before-quit': 1.6-second app shutdown timer elapsed. Forcing quit.");
      global.closing = 2;
      app.quit();
    }, 1600); // Your original 1.6-second timeout
  } else {
    console.log("'before-quit': Already in closing process (closing === 2).");
  }
});

const folder = path.join(app.getPath('appData'), `${app.name}`);
if (!fs.existsSync(folder)) {
	fs.mkdirSync(folder, { recursive: true });
}
app.setPath('userData', folder);

function checkProtocolHandler() {
  const isDefault = app.isDefaultProtocolClient('electroncapture');
  console.log('Is electroncapture protocol handler registered?', isDefault);
  
  if (!isDefault) {
    const success = app.setAsDefaultProtocolClient('electroncapture');
    console.log('Attempted to register protocol handler:', success);
  }
}

// Remove the checkProtocolHandler function as it's redundant with registerProtocolHandling

app.whenReady().then(function(){
    console.log("APP READY");
    
    // Set up permission handling
    session.fromPartition("default").setPermissionRequestHandler((webContents, permission, callback) => {
        try {
            let allowedPermissions = [
                "audioCapture", 
                "desktopCapture", 
                "pageCapture", 
                "tabCapture", 
                "experimental"
            ];
            
            if (allowedPermissions.includes(permission)) {
                callback(true); // Approve permission request
            } else {
                console.error(
                    `The application tried to request permission for '${permission}'. This permission was not whitelisted and has been blocked.`
                );
                callback(false); // Deny
            }
        } catch(e) {
            console.error(e);
            callback(false); // Deny on error
        }
    });

	// Register protocol handler first
	registerProtocolHandling();
	
	createWindow(Argv);
	if (Argv.gpuinfo) {
		openGpuDiagnosticsWindow();
	}
    
    // Handle Windows-specific startup
    if (process.platform === 'win32') {
        try {
            const squirrelStartup = require('electron-squirrel-startup');
            if (squirrelStartup) {
                app.quit();
                return;
            }
        } catch(e) {
            console.error('Error checking squirrel startup:', e);
        }
    }
}).catch(console.error);


// Add Windows installer events if you're using electron-squirrel-startup
if (require('electron-squirrel-startup')) app.quit();

if (process.platform === 'win32') {
  const handleStartupEvent = () => {
    if (process.platform !== 'win32') {
      return false;
    }

    const squirrelCommand = process.argv[1];
    switch (squirrelCommand) {
      case '--squirrel-install':
      case '--squirrel-updated':
        // Register protocol handler
        registerProtocolHandling();
        return true;
      case '--squirrel-uninstall':
        // Remove protocol handler registration
        app.removeAsDefaultProtocolClient('electroncapture');
        return true;
      case '--squirrel-obsolete':
        app.quit();
        return true;
    }
  };

  if (handleStartupEvent()) {
    app.quit();
  }
}

app.on('ready', () => {
    // Clear any problematic cache entries on startup
    const userDataPath = app.getPath('userData');
    const cachePath = path.join(userDataPath, 'Cache');
    try {
        if (fs.existsSync(cachePath)) {
            fs.rmdirSync(cachePath, { recursive: true });
        }
    } catch (error) {
        console.warn('Could not clear cache:', error);
    }

    // Your existing ready handler code
    app.on('web-contents-created', (e, wc) => {
        wc.on('context-menu', (ee, params) => {
            wc.send('context-menu-ipc', params);
        });
    });
    
    app.on('browser-window-focus', (event, win) => {
        console.log('browser-window-focus', win.webContents.id);
        win.setIgnoreMouseEvents(false);
    });
    
    if (!isDev) {
        registerProtocolHandling();
    }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(Argv); // createWindow will load and apply saved state
  }
});

electron.powerMonitor.on('on-battery', () => {
	var notification = new electron.Notification(
		{
			title: 'Electron-capture performance is degraded',
			body: 'You are now on battery power. Please consider connecting your charger for improved performance.',
			icon: path.join(__dirname, "assets", "icons", "png", "256x256.png")
		});
	notification.show();
})
ipcMain.handle('windowAudio:isAvailable', () => {
	return { available: windowAudioCaptureAvailable && !!windowAudioCapture };
});

ipcMain.on('windowAudio:availability-sync', (event) => {
	event.returnValue = { available: windowAudioCaptureAvailable && !!windowAudioCapture };
});
