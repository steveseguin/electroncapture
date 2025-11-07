// preload.js
const { ipcRenderer, contextBridge } = require('electron');

let WindowAudioStream = null;
try {
  WindowAudioStream = require('./window-audio-stream.js');
  if (WindowAudioStream && typeof WindowAudioStream !== 'function' && WindowAudioStream.default) {
    WindowAudioStream = WindowAudioStream.default;
  }
  if (WindowAudioStream) {
    const moduleAliases = new Set([
      './window-audio-stream.js',
      'window-audio-stream.js',
      'window-audio-stream'
    ]);
    const globalScope = typeof window !== 'undefined' ? window : globalThis;
    const patchLoader = (loaderName) => {
      if (!globalScope || typeof globalScope[loaderName] !== 'function') {
        return;
      }
      const original = globalScope[loaderName];
      if (original && original.__windowAudioStreamShimmed) {
        return;
      }
      const wrapped = function patchedLoader(request, ...rest) {
        if (moduleAliases.has(request)) {
          return WindowAudioStream;
        }
        return original.apply(this, [request, ...rest]);
      };
      wrapped.__windowAudioStreamShimmed = true;
      if (original && typeof original.resolve === 'function') {
        wrapped.resolve = original.resolve.bind(original);
      }
      try {
        globalScope[loaderName] = wrapped;
      } catch (error) {
        console.warn(`Unable to patch ${loaderName} for WindowAudioStream access:`, error);
      }
    };
    ['require', 'preloadRequire'].forEach(patchLoader);
    try {
      if (globalScope && !globalScope.WindowAudioStream) {
        globalScope.WindowAudioStream = WindowAudioStream;
      }
    } catch (error) {
      console.warn('Unable to expose WindowAudioStream on global scope:', error);
    }
  }
} catch (error) {
  console.error('Failed to load WindowAudioStream module:', error);
}

const WINDOW_AUDIO_EVENT_CHANNEL = 'windowAudioStreamData';
const APP_AUDIO_PARAM_NAMES = ['appaudio', 'appAudio', 'appAudioTarget'];
const GAME_CAPTURE_UPDATE_CHANNEL = 'gamecapture:update';
const GAME_CAPTURE_HOST_PATTERNS = [/vdo\.ninja$/i, /versus\.cam$/i, /localhost$/i, /(^|\.)127\.0\.0\.1$/];

let appAudioTarget = null;
let windowAudioStreamInstance = null;
let displayMediaHookInstalled = false;
let currentGameCaptureContext = null;
let overlayElements = null;
let overlayInstallScheduled = false;
let overlayVisible = true;
let overlayHotkeyRegistered = false;
let overlayAutoHideTimer = null;
let overlayAutoHidden = false;
let overlayWasVisibleBeforeAutoHide = false;
let overlayStatusResetTimer = null;

const SHARE_PICKER_HIDE_TIMEOUT_MS = 4500;

const encoderPreferences = {
  defaultMode: 'hardware',
  preferredMode: 'hardware',
  codecPreference: 'auto',
  maxBitrate: 0
};

function parseEncoderMode(rawValue) {
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
  return null;
}

const DEFAULT_OVERRIDE_SENTINEL = '__electronCaptureDefaultMode';

function normalizeEncoderModeOverride(rawValue) {
  if (rawValue === undefined || rawValue === null) {
    return DEFAULT_OVERRIDE_SENTINEL;
  }
  if (typeof rawValue === 'string') {
    const token = rawValue.trim().toLowerCase();
    if (token === 'default' || token === 'reset') {
      return DEFAULT_OVERRIDE_SENTINEL;
    }
  }
  return parseEncoderMode(rawValue);
}

function applyPreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') {
    return;
  }
  const normalizedDefault = parseEncoderMode(preferences.defaultMode);
  if (normalizedDefault) {
    encoderPreferences.defaultMode = normalizedDefault;
  }
  const normalizedPreferred = parseEncoderMode(preferences.preferredMode);
  encoderPreferences.preferredMode = normalizedPreferred || encoderPreferences.defaultMode;

  if (typeof preferences.codecPreference === 'string' && preferences.codecPreference.trim().length) {
    encoderPreferences.codecPreference = preferences.codecPreference.trim();
  }

  if (typeof preferences.maxBitrate === 'number' && Number.isFinite(preferences.maxBitrate) && preferences.maxBitrate >= 0) {
    encoderPreferences.maxBitrate = Math.floor(preferences.maxBitrate);
  }
}

ipcRenderer.invoke('hardware-encoding:get-preferences')
  .then(applyPreferences)
  .catch((error) => {
    console.warn('Unable to load hardware encoding preferences:', error);
  });

ipcRenderer.on('hardware-encoding:mode-updated', (_event, mode) => {
  const normalized = parseEncoderMode(mode);
  encoderPreferences.preferredMode = normalized || encoderPreferences.defaultMode;
});

function openGpuDiagnosticsFromRenderer() {
  return ipcRenderer.invoke('hardware-encoding:open-gpu-diagnostics')
    .then((result) => Boolean(result))
    .catch((error) => {
      console.warn('Failed to open GPU diagnostics window:', error);
      return false;
    });
}

function exposeEncoderControls() {
  const api = {
    getState: () => ({
      defaultMode: encoderPreferences.defaultMode,
      preferredMode: encoderPreferences.preferredMode,
      codecPreference: encoderPreferences.codecPreference,
      maxBitrate: encoderPreferences.maxBitrate
    }),
    setPreferredMode: (mode) => {
      const normalized = normalizeEncoderModeOverride(mode);
      if (!normalized) {
        return encoderPreferences.preferredMode;
      }
      if (normalized === DEFAULT_OVERRIDE_SENTINEL) {
        encoderPreferences.preferredMode = encoderPreferences.defaultMode;
        ipcRenderer.send('hardware-encoding:set-mode', null);
        return encoderPreferences.preferredMode;
      }
      encoderPreferences.preferredMode = normalized;
      ipcRenderer.send('hardware-encoding:set-mode', normalized);
      return encoderPreferences.preferredMode;
    },
    resetPreferredMode: () => {
      encoderPreferences.preferredMode = encoderPreferences.defaultMode;
      ipcRenderer.send('hardware-encoding:set-mode', null);
      return encoderPreferences.preferredMode;
    },
    openGpuDiagnostics: () => openGpuDiagnosticsFromRenderer()
  };

  try {
    contextBridge.exposeInMainWorld('electronCaptureEncoder', api);
  } catch (error) {
    console.warn('Unable to expose encoder controls via contextBridge; falling back to window property.', error);
    window.electronCaptureEncoder = api;
  }
}

exposeEncoderControls();
function sanitizeAppAudioTarget(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) {
      return null;
    }
    return String(Math.floor(value));
  }
  if (typeof value === 'bigint') {
    if (value <= 0n) {
      return null;
    }
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed.length) {
      return null;
    }
    const lower = trimmed.toLowerCase();
    if (['0', 'none', 'false', 'off', 'null'].includes(lower)) {
      return null;
    }
    return trimmed;
  }
  return null;
}

function extractAppAudioTargetFromUrl() {
  try {
    const currentUrl = new URL(window.location.href);
    for (const key of APP_AUDIO_PARAM_NAMES) {
      const value = currentUrl.searchParams.get(key);
      if (value) {
        return value;
      }
    }
  } catch (error) {
    console.warn('Unable to parse app audio target from URL:', error);
  }
  return null;
}

function ensureWindowAudioStreamInstance() {
  if (!WindowAudioStream) {
    return null;
  }
  if (!windowAudioStreamInstance) {
    windowAudioStreamInstance = new WindowAudioStream();
  }
  return windowAudioStreamInstance;
}

function updateAppAudioTarget(value) {
  const sanitized = sanitizeAppAudioTarget(value);
  if (sanitized === appAudioTarget) {
    return appAudioTarget;
  }

  appAudioTarget = sanitized;

  if (windowAudioStreamInstance && windowAudioStreamInstance.isCapturing()) {
    windowAudioStreamInstance.stop().catch((error) => {
      console.warn('Failed to stop window audio stream after retargeting:', error);
    });
  }

  return appAudioTarget;
}

async function attachApplicationAudio(stream) {
  if (!appAudioTarget) {
    return;
  }

  const instance = ensureWindowAudioStreamInstance();
  if (!instance) {
    console.warn('WindowAudioStream unavailable; skipping application audio attachment.');
    return;
  }

  try {
    const audioStream = await instance.start(appAudioTarget);
    if (!audioStream) {
      console.warn('WindowAudioStream returned no audio stream for target:', appAudioTarget);
      return;
    }

    const clonedTracks = [];
    audioStream.getAudioTracks().forEach((track) => {
      const clone = track.clone();
      clonedTracks.push(clone);
      stream.addTrack(clone);
    });

    const cleanup = async () => {
      clonedTracks.forEach((track) => {
        try {
          track.stop();
        } catch (error) {
          console.warn('Error stopping cloned audio track:', error);
        }
      });
      if (instance.isCapturing()) {
        try {
          await instance.stop();
        } catch (error) {
          console.warn('Failed to stop WindowAudioStream during cleanup:', error);
        }
      }
    };

    const onceCleanup = () => {
      cleanup().catch((error) => console.error('Error cleaning up application audio tracks:', error));
    };

    if (typeof stream.addEventListener === 'function') {
      stream.addEventListener('inactive', onceCleanup, { once: true });
    }
    stream.getVideoTracks().forEach((track) => track.addEventListener('ended', onceCleanup, { once: true }));
    clonedTracks.forEach((track) => track.addEventListener('ended', onceCleanup, { once: true }));
  } catch (error) {
    console.error('Failed to attach application audio to display stream:', error);
  }
}

function normalizeCursorPreferenceValue(raw) {
  if (raw === null || raw === undefined) {
    return null;
  }
  const token = String(raw).trim().toLowerCase();
  if (!token.length) {
    return null;
  }
  if (token === 'never' || token === 'hide' || token === 'hidden' || token === 'off' || token === 'none') {
    return 'never';
  }
  if (token === 'always' || token === 'default' || token === 'show' || token === 'system' || token === 'on') {
    return 'always';
  }
  if (token === 'motion' || token === 'auto' || token === 'movement') {
    return 'motion';
  }
  if (token === 'visible') {
    return 'always';
  }
  if (token === 'dynamic') {
    return 'motion';
  }
  if (token === 'none') {
    return 'never';
  }
  if (token === 'full') {
    return 'always';
  }
  return null;
}

function determinePreferredCursorMode() {
  if (!currentGameCaptureContext) {
    return null;
  }
  const explicit = normalizeCursorPreferenceValue(currentGameCaptureContext.cursorPreference);
  if (explicit) {
    return explicit;
  }
  if (currentGameCaptureContext.mode === 'game') {
    return 'never';
  }
  return null;
}

function normalizeDisplayMediaConstraints(input) {
  if (input && typeof input === 'object') {
    const cloned = { ...input };
    if ('audio' in cloned && cloned.audio && typeof cloned.audio === 'object') {
      cloned.audio = { ...cloned.audio };
    }
    if ('video' in cloned) {
      if (cloned.video && typeof cloned.video === 'object') {
        cloned.video = { ...cloned.video };
      }
    }
    return cloned;
  }
  if (typeof input === 'boolean') {
    return { video: input };
  }
  return {};
}

function applyCursorPreferenceToStream(stream, cursorMode) {
  if (!stream || !cursorMode) {
    return;
  }
  try {
    const tracks = stream.getVideoTracks ? stream.getVideoTracks() : [];
    tracks.forEach((track) => {
      if (track && typeof track.applyConstraints === 'function') {
        track.applyConstraints({ advanced: [{ cursor: cursorMode }] }).catch((error) => {
          console.warn('Unable to enforce cursor preference on track:', error);
        });
      }
    });
  } catch (error) {
    console.warn('Failed to apply cursor preference to stream:', error);
  }
}

function installDisplayMediaHook() {
  if (displayMediaHookInstalled) {
    return;
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    return;
  }

  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

  navigator.mediaDevices.getDisplayMedia = async (...args) => {
    const cursorMode = determinePreferredCursorMode();
    let constraints = args && args.length ? args[0] : undefined;
    let normalizedConstraints = normalizeDisplayMediaConstraints(constraints);
    if (normalizedConstraints.video === undefined) {
      normalizedConstraints.video = {};
    }
    if (normalizedConstraints.video === true) {
      normalizedConstraints.video = {};
    }
    if (normalizedConstraints.video && typeof normalizedConstraints.video === 'object' && cursorMode) {
      normalizedConstraints.video.cursor = cursorMode;
      console.log('[VersusGameCapture] Forcing displayMedia cursor mode to', cursorMode);
    }
    const stream = await originalGetDisplayMedia(normalizedConstraints);
    if (cursorMode) {
      applyCursorPreferenceToStream(stream, cursorMode);
    }
    if (appAudioTarget) {
      await attachApplicationAudio(stream);
    }
    return stream;
  };

  displayMediaHookInstalled = true;
}

appAudioTarget = sanitizeAppAudioTarget(extractAppAudioTargetFromUrl());
if (appAudioTarget) {
  console.log('WindowAudioStream: App audio target configured as', appAudioTarget);
}
installDisplayMediaHook();

window.addEventListener('beforeunload', () => {
  if (windowAudioStreamInstance && windowAudioStreamInstance.isCapturing()) {
    windowAudioStreamInstance.stop().catch((error) => {
      console.warn('Error stopping WindowAudioStream on unload:', error);
    });
  }
});

window.addEventListener('DOMContentLoaded', () => {
  installDisplayMediaHook();
  const replaceText = (selector, text) => {
    const element = document.getElementById(selector);
    if (element) element.innerText = text;
  };
  for (const type of ['chrome', 'node', 'electron']) {
    replaceText(`${type}-version`, process.versions[type]);
  }
  try {
    if (session && session.version) {
      ipcRenderer.send('vdonVersion', { ver: session.version });
    }
  } catch (e) {}
});

let doSomethingInWebApp = null;

function createWindowAudioAvailabilityBridge() {
  let cachedValue = null;
  let inFlight = null;

  const querySync = () => {
    if (cachedValue !== null) {
      return cachedValue;
    }
    if (!ipcRenderer) {
      return null;
    }
    try {
      if (typeof ipcRenderer.sendSync === 'function') {
        const response = ipcRenderer.sendSync('windowAudio:availability-sync');
        cachedValue = Boolean(response && response.available);
        return cachedValue;
      }
    } catch (error) {
      console.warn('windowAudio availability sync query failed:', error);
      cachedValue = false;
      return cachedValue;
    }
    return null;
  };

  const refresh = () => {
    if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
      return Promise.resolve(querySync() || false);
    }
    if (inFlight) {
      return inFlight;
    }
    inFlight = ipcRenderer.invoke('windowAudio:isAvailable').then((result) => {
      cachedValue = Boolean(result && result.available);
      inFlight = null;
      return cachedValue;
    }).catch((error) => {
      console.warn('Unable to determine window audio availability:', error);
      cachedValue = false;
      inFlight = null;
      return cachedValue;
    });
    return inFlight;
  };

  return {
    isAvailableSync: () => {
      const value = querySync();
      if (value === null) {
        return false;
      }
      return value;
    },
    refresh
  };
}

const windowAudioAvailability = createWindowAudioAvailabilityBridge();

function createElectronApi() {
  return {
    'exposeDoSomethingInWebApp': function(callback) {
      doSomethingInWebApp = callback;
    },
    'updateVersion': function(version) {
      console.log("33:" + version);
      ipcRenderer.send('vdonVersion', { ver: version });
    },
    'updatePPT': function(PPTHotkey) {
      console.log("updatePPT received!!!");
      ipcRenderer.send('PPTHotkey', PPTHotkey);
    },
    'noCORSFetch': (args) => ipcRenderer.invoke('noCORSFetch', args),
    'readStreamChunk': (streamId) => ipcRenderer.invoke('readStreamChunk', streamId),
    'closeStream': (streamId) => ipcRenderer.invoke('closeStream', streamId),
    'startStreamCapture': (target) => ipcRenderer.invoke('windowAudio:startStreamCapture', target),
    'stopStreamCapture': (target) => ipcRenderer.invoke('windowAudio:stopStreamCapture', target),
    'getWindowAudioTargets': () => ipcRenderer.invoke('windowAudio:getTargets'),
    'getWindowAudioSessions': () => ipcRenderer.invoke('windowAudio:getSessions'),
    'onAudioStreamData': (callback) => {
      if (typeof callback !== 'function') {
        return () => {};
      }
      const handler = (_event, payload) => {
        try {
          callback(payload);
        } catch (err) {
          console.error('Error in onAudioStreamData handler:', err);
        }
      };
      ipcRenderer.on(WINDOW_AUDIO_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(WINDOW_AUDIO_EVENT_CHANNEL, handler);
    },
    'setAppAudioTarget': (target) => {
      const updated = updateAppAudioTarget(target);
      installDisplayMediaHook();
      return { success: true, target: updated };
    },
    'getAppAudioTarget': () => appAudioTarget,
    'isWindowAudioCaptureAvailable': () => Boolean(windowAudioAvailability.isAvailableSync())
  };
}
const electronApi = createElectronApi();

(function registerElectronApi() {
  const canUseContextBridge = Boolean(process && process.contextIsolated && contextBridge && typeof contextBridge.exposeInMainWorld === 'function');
  let exposedViaContextBridge = false;

  if (canUseContextBridge) {
    try {
      contextBridge.exposeInMainWorld('electronApi', electronApi);
      if (WindowAudioStream) {
        contextBridge.exposeInMainWorld('WindowAudioStream', WindowAudioStream);
      }
      exposedViaContextBridge = true;
    } catch (error) {
      console.error('Failed to expose APIs via contextBridge:', error);
    }
  }

  if (!exposedViaContextBridge) {
    try {
      window.electronApi = electronApi;
      if (WindowAudioStream) {
        window.WindowAudioStream = WindowAudioStream;
      }
    } catch (error) {
      console.error('Failed to attach APIs to window:', error);
    }
  } else if (WindowAudioStream) {
    // Provide a mirror on window as well for compatibility when contextIsolation is enabled.
    try {
      window.WindowAudioStream = WindowAudioStream;
    } catch (error) {
      // Ignore - window may not be writable in some sandboxed contexts.
    }
  }
})();

windowAudioAvailability.refresh();

window.addEventListener('message', ({ data }) => {
	console.log("preload.js-Message-Incoming: "+data);
    ipcRenderer.send('postMessage', data)
});


try {
	if ((typeof session !== 'undefined') && session.version){
		ipcRenderer.send('vdonVersion', {ver:session.version}); // clear the current Version; let it load if needed.
	} else {
		ipcRenderer.send('vdonVersion', {ver:false}); // clear the current Version; let it load if needed.
	}
} catch(e){
	console.log(e);
}


function createGameCaptureBridge() {
  const normalizePayload = (payload) => {
    if (typeof payload === 'string') {
      return { url: payload };
    }
    if (payload && typeof payload === 'object') {
      return payload;
    }
    return {};
  };

  const api = {
    getContext: () => ipcRenderer.invoke('gamecapture:get-context'),
    launchInvite: (payload) => ipcRenderer.invoke('gamecapture:launch-invite', normalizePayload(payload)),
    returnToShell: () => ipcRenderer.invoke('gamecapture:return-to-shell'),
    getShareProfile: () => ipcRenderer.invoke('gamecapture:get-share-profile'),
    updateShareProfile: (payload) => ipcRenderer.invoke('gamecapture:update-share-profile', payload || {}),
    regenerateStreamId: (payload) => ipcRenderer.invoke('gamecapture:regenerate-stream-id', payload || {}),
    windowAction: (payload) => ipcRenderer.invoke('gamecapture:window-action', payload || {}),
    resizeWindow: (payload) => ipcRenderer.invoke('gamecapture:window-resize', payload || {}),
    onUpdate: (callback) => {
      if (typeof callback !== 'function') {
        return () => {};
      }
      const handler = (_event, message) => {
        try {
          callback(message);
        } catch (error) {
          console.error('electronGameCapture onUpdate handler failed:', error);
        }
      };
      ipcRenderer.on('gamecapture:update', handler);
      return () => {
        ipcRenderer.removeListener('gamecapture:update', handler);
      };
    }
  };

  return api;
}

(function registerGameCaptureBridge() {
  const bridge = createGameCaptureBridge();
  const canUseContextBridge = Boolean(process && process.contextIsolated && contextBridge && typeof contextBridge.exposeInMainWorld === 'function');
  if (canUseContextBridge) {
    try {
      contextBridge.exposeInMainWorld('electronGameCapture', bridge);
      return;
    } catch (error) {
      console.warn('Failed to expose electronGameCapture via contextBridge, falling back to window:', error);
    }
  }
  try {
    window.electronGameCapture = bridge;
  } catch (error) {
    console.warn('Unable to attach electronGameCapture bridge to window:', error);
  }
})();

function hostMatchesGameCaptureTarget() {
  try {
    const hostname = (window.location && window.location.hostname) || '';
    return GAME_CAPTURE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch (error) {
    console.warn('Unable to evaluate hostname for overlay eligibility:', error);
    return false;
  }
}

function updateTrackedGameCaptureContext(nextState) {
  currentGameCaptureContext = nextState || null;
  if (!currentGameCaptureContext) {
    return;
  }
  if (currentGameCaptureContext.mode === 'game') {
    maybeInstallGameCaptureOverlay();
    updateGameCaptureOverlay();
  }
}

const handleGameCaptureUpdate = (_event, payload) => {
  updateTrackedGameCaptureContext(payload && payload.state);
};

ipcRenderer.on(GAME_CAPTURE_UPDATE_CHANNEL, handleGameCaptureUpdate);
ipcRenderer.invoke('gamecapture:get-context')
  .then((context) => {
    updateTrackedGameCaptureContext(context);
  })
  .catch((error) => {
    console.warn('Unable to hydrate game capture context:', error);
  });

window.addEventListener('beforeunload', () => {
  ipcRenderer.removeListener(GAME_CAPTURE_UPDATE_CHANNEL, handleGameCaptureUpdate);
});

function maybeInstallGameCaptureOverlay() {
  if (overlayElements || overlayInstallScheduled) {
    return;
  }
  if (!currentGameCaptureContext || currentGameCaptureContext.mode !== 'game') {
    return;
  }
  if (!hostMatchesGameCaptureTarget()) {
    return;
  }
  if (!document || document.readyState === 'loading') {
    overlayInstallScheduled = true;
    document.addEventListener('DOMContentLoaded', () => {
      overlayInstallScheduled = false;
      maybeInstallGameCaptureOverlay();
    }, { once: true });
    return;
  }
  overlayElements = createGameCaptureOverlayElements();
  updateGameCaptureOverlay();
  ensureOverlayHotkey();
}

function ensureOverlayHotkey() {
  if (overlayHotkeyRegistered) {
    return;
  }
  window.addEventListener('keydown', handleOverlayHotkey, true);
  overlayHotkeyRegistered = true;
}

function handleOverlayHotkey(event) {
  if (!overlayElements) {
    return;
  }
  if (event.ctrlKey && event.shiftKey && event.code === 'KeyL') {
    event.preventDefault();
    event.stopPropagation();
    setOverlayVisibility(!overlayVisible);
  }
}

function createGameCaptureOverlayElements() {
  const existingStyles = document.getElementById('versus-game-overlay-styles');
  if (!existingStyles) {
    const style = document.createElement('style');
    style.id = 'versus-game-overlay-styles';
    style.textContent = `
      #versus-game-overlay {
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 2147483000;
        font-family: "Inter","Segoe UI",system-ui,-apple-system,BlinkMacSystemFont,sans-serif;
        pointer-events: none;
        color: #f4f4f6;
      }
      #versus-game-overlay .gc-panel {
        pointer-events: auto;
        width: min(380px, calc(100vw - 32px));
        background: rgba(6,7,12,0.95);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 18px;
        padding: 18px 18px 16px;
        box-shadow: 0 25px 60px rgba(0,0,0,0.55);
        backdrop-filter: blur(18px);
      }
      #versus-game-overlay .gc-panel.gc-hidden {
        display: none;
      }
      #versus-game-overlay .gc-panel-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
      }
      #versus-game-overlay .gc-panel-title {
        margin: 0;
        font-size: 1.05rem;
        font-weight: 600;
      }
      #versus-game-overlay .gc-panel-status {
        margin: 4px 0 0;
        font-size: 0.95rem;
        color: rgba(255,255,255,0.75);
      }
      #versus-game-overlay .gc-icon-btn {
        border: none;
        background: rgba(255,255,255,0.08);
        color: #fff;
        border-radius: 10px;
        width: 32px;
        height: 32px;
        font-size: 1.1rem;
        cursor: pointer;
      }
      #versus-game-overlay .gc-meta {
        list-style: none;
        margin: 16px 0 10px;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      #versus-game-overlay .gc-meta li {
        background: rgba(255,255,255,0.04);
        border-radius: 12px;
        padding: 10px;
      }
      #versus-game-overlay .gc-meta span {
        display: block;
        font-size: 0.75rem;
        text-transform: uppercase;
        color: rgba(255,255,255,0.55);
        letter-spacing: 0.08em;
        margin-bottom: 3px;
      }
      #versus-game-overlay .gc-meta strong {
        font-size: 0.95rem;
        font-weight: 600;
      }
      #versus-game-overlay .gc-link-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255,255,255,0.03);
        border: 1px solid rgba(255,255,255,0.06);
        margin-top: 6px;
      }
      #versus-game-overlay .gc-link-meta span {
        display: block;
        font-size: 0.73rem;
        text-transform: uppercase;
        color: rgba(255,255,255,0.55);
        letter-spacing: 0.08em;
      }
      #versus-game-overlay .gc-link-meta p {
        margin: 0.15rem 0 0;
        font-size: 0.9rem;
        color: rgba(255,255,255,0.9);
        word-break: break-all;
      }
      #versus-game-overlay .gc-link-actions {
        display: flex;
        gap: 0.35rem;
      }
      #versus-game-overlay .gc-link-actions button {
        flex: 1 1 auto;
      }
      #versus-game-overlay .gc-stats {
        margin-top: 12px;
      }
      #versus-game-overlay .gc-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 12px;
      }
      #versus-game-overlay button.gc-primary {
        flex: 1 1 140px;
        background: linear-gradient(120deg, #6c63ff, #2ecbff);
        border: none;
        color: #fff;
        padding: 0.75rem 1rem;
        border-radius: 12px;
        font-weight: 600;
        font-size: 0.95rem;
        cursor: pointer;
      }
      #versus-game-overlay button.gc-secondary {
        flex: 1 1 120px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.15);
        color: #fff;
        padding: 0.7rem 1rem;
        border-radius: 12px;
        font-weight: 600;
        font-size: 0.9rem;
        cursor: pointer;
      }
      #versus-game-overlay button.gc-tertiary {
        flex: 0 0 auto;
        background: none;
        border: none;
        color: rgba(255,255,255,0.7);
        font-size: 0.85rem;
        text-decoration: underline;
        cursor: pointer;
        padding: 0.5rem 0.65rem;
      }
      #versus-game-overlay .gc-hint {
        margin: 10px 0 0;
        font-size: 0.75rem;
        color: rgba(255,255,255,0.6);
      }
      #versus-game-overlay .gc-toggle {
        pointer-events: auto;
        margin-top: 8px;
        background: rgba(6,7,12,0.9);
        border: 1px solid rgba(255,255,255,0.2);
        color: #fff;
        padding: 0.5rem 1rem;
        border-radius: 999px;
        font-size: 0.85rem;
        cursor: pointer;
      }
      #versus-game-overlay .gc-toggle.gc-hidden {
        display: none;
      }
      @media (max-width: 640px) {
        #versus-game-overlay {
          left: 50%;
          right: auto;
          transform: translateX(-50%);
          top: 12px;
        }
        #versus-game-overlay .gc-panel {
          width: min(420px, calc(100vw - 24px));
        }
      }
    `;
    document.head.appendChild(style);
  }

  const root = document.createElement('div');
  root.id = 'versus-game-overlay';
  root.innerHTML = `
    <div class="gc-panel">
      <div class="gc-panel-header">
        <div>
          <p class="gc-panel-title">Versus Game Capture</p>
          <p class="gc-panel-status" id="gcOverlayStatus">Setting up…</p>
        </div>
        <button class="gc-icon-btn" type="button" data-action="hide" title="Hide capture HUD">×</button>
      </div>
      <ul class="gc-meta">
        <li><span>Slot</span><strong id="gcOverlaySlot">—</strong></li>
        <li><span>Preset</span><strong id="gcOverlayPreset">—</strong></li>
        <li><span>Cursor</span><strong id="gcOverlayCursor">Auto</strong></li>
        <li><span>Audio</span><strong id="gcOverlayAudio">System</strong></li>
        <li><span>Transport</span><strong id="gcOverlayTransport">Auto</strong></li>
        <li><span>Invite</span><strong id="gcOverlayInvite">—</strong></li>
      </ul>
      <div class="gc-link-card">
        <div class="gc-link-meta">
          <span>Viewer link</span>
          <p id="gcOverlayViewerLink">—</p>
        </div>
        <div class="gc-link-actions">
          <button class="gc-tertiary" type="button" data-action="copy-link">Copy</button>
          <button class="gc-tertiary" type="button" data-action="open-link">Open</button>
        </div>
      </div>
      <ul class="gc-meta gc-stats">
        <li><span>Stream ID</span><strong id="gcOverlayStreamId">—</strong></li>
        <li><span>Target bitrate</span><strong id="gcOverlayBitrate">—</strong></li>
        <li><span>View bitrate</span><strong id="gcOverlayViewBitrate">—</strong></li>
        <li><span>Codec</span><strong id="gcOverlayCodec">—</strong></li>
        <li><span>Resolution</span><strong id="gcOverlayResolution">—</strong></li>
        <li><span>Viewers</span><strong id="gcOverlayViewers">—</strong></li>
      </ul>
      <div class="gc-buttons">
        <button class="gc-primary" type="button" data-action="share">Share your game</button>
        <button class="gc-secondary" type="button" data-action="mute">Mute mic</button>
        <button class="gc-secondary" type="button" data-action="hangup">Hang up</button>
        <button class="gc-secondary" type="button" data-action="return">Return to lobby</button>
        <button class="gc-tertiary" type="button" data-action="reload">Reload</button>
      </div>
      <p class="gc-hint">Need the classic UI? Use the controls behind this panel or hide it with Ctrl + Shift + L.</p>
    </div>
    <button class="gc-toggle gc-hidden" type="button" data-action="show">Show capture HUD</button>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector('.gc-panel');
  const toggle = root.querySelector('.gc-toggle');
  const refs = {
    root,
    panel,
    toggle,
    status: root.querySelector('#gcOverlayStatus'),
    slot: root.querySelector('#gcOverlaySlot'),
    preset: root.querySelector('#gcOverlayPreset'),
    cursor: root.querySelector('#gcOverlayCursor'),
    audio: root.querySelector('#gcOverlayAudio'),
    transport: root.querySelector('#gcOverlayTransport'),
    invite: root.querySelector('#gcOverlayInvite'),
    viewerLink: root.querySelector('#gcOverlayViewerLink'),
    streamId: root.querySelector('#gcOverlayStreamId'),
    bitrate: root.querySelector('#gcOverlayBitrate'),
    viewBitrate: root.querySelector('#gcOverlayViewBitrate'),
    codec: root.querySelector('#gcOverlayCodec'),
    resolution: root.querySelector('#gcOverlayResolution'),
    viewers: root.querySelector('#gcOverlayViewers'),
    copyLinkBtn: root.querySelector('[data-action="copy-link"]'),
    openLinkBtn: root.querySelector('[data-action="open-link"]'),
    muteBtn: root.querySelector('[data-action="mute"]')
  };

  const actionHandlers = {
    hide: () => setOverlayVisibility(false),
    show: () => setOverlayVisibility(true),
    share: handleOverlayShareClick,
    return: handleOverlayReturnClick,
    reload: () => {
      try {
        window.location.reload();
      } catch (error) {
        console.warn('Unable to reload capture view:', error);
      }
    },
    'copy-link': copyOverlayViewerLink,
    'open-link': openOverlayViewerLink,
    mute: handleOverlayMuteClick,
    hangup: handleOverlayHangupClick
  };

  root.querySelectorAll('[data-action]').forEach((node) => {
    const action = node.getAttribute('data-action');
    if (action && actionHandlers[action]) {
      node.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        actionHandlers[action](event);
      });
    }
  });

  return refs;
}

function setOverlayVisibility(visible) {
  overlayVisible = !!visible;
  if (!overlayElements) {
    return;
  }
  if (overlayVisible) {
    overlayElements.panel.classList.remove('gc-hidden');
    overlayElements.toggle.classList.add('gc-hidden');
  } else {
    overlayElements.panel.classList.add('gc-hidden');
    overlayElements.toggle.classList.remove('gc-hidden');
  }
}

function temporarilyHideOverlayDuringPicker() {
  if (!overlayElements) {
    return;
  }
  overlayWasVisibleBeforeAutoHide = overlayVisible;
  if (!overlayVisible) {
    return;
  }
  if (overlayAutoHideTimer) {
    clearTimeout(overlayAutoHideTimer);
    overlayAutoHideTimer = null;
  }
  setOverlayVisibility(false);
  overlayAutoHidden = true;
  overlayAutoHideTimer = setTimeout(() => {
    overlayAutoHideTimer = null;
    if (overlayAutoHidden && overlayWasVisibleBeforeAutoHide) {
      setOverlayVisibility(true);
    }
    overlayAutoHidden = false;
  }, SHARE_PICKER_HIDE_TIMEOUT_MS);
}

function restoreOverlayAfterPickerFailure() {
  if (overlayAutoHideTimer) {
    clearTimeout(overlayAutoHideTimer);
    overlayAutoHideTimer = null;
  }
  if (overlayAutoHidden && overlayWasVisibleBeforeAutoHide) {
    setOverlayVisibility(true);
  }
  overlayAutoHidden = false;
}

function handleOverlayShareClick() {
  temporarilyHideOverlayDuringPicker();
  if (invokePublishScreenApi()) {
    return;
  }
  if (triggerScreenshareButton()) {
    return;
  }
  restoreOverlayAfterPickerFailure();
  if (overlayElements && overlayElements.status) {
    overlayElements.status.textContent = 'Waiting for VDO.Ninja controls…';
  }
}

function handleOverlayReturnClick() {
  ipcRenderer.invoke('gamecapture:return-to-shell').catch((error) => {
    console.warn('Failed to return to shell from overlay:', error);
  });
}

function invokePublishScreenApi() {
  const candidates = ['publishScreen', 'publishScreen2', 'startScreenShare', 'shareScreen'];
  for (const name of candidates) {
    const fn = window[name];
    if (typeof fn === 'function') {
      try {
        fn();
        return true;
      } catch (error) {
        console.warn(`Failed to invoke ${name}:`, error);
      }
    }
  }
  return false;
}

function triggerScreenshareButton() {
  const selectors = ['#screensharebutton', '#screenshare2button', '#screenshare3button', 'button[data-action="screenshare"]', '[data-control="screenshare"]'];
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (node && typeof node.click === 'function' && !node.disabled) {
      try {
        node.click();
        if (typeof node.focus === 'function') {
          node.focus();
        }
        return true;
      } catch (error) {
        console.warn('Failed to trigger screenshare button:', error);
      }
    }
  }
  return false;
}

function copyTextToClipboard(value) {
  if (!value) {
    return Promise.reject(new Error('Nothing to copy.'));
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(value);
  }
  return Promise.reject(new Error('Clipboard unavailable'));
}

function getOverlayViewerLinkValue() {
  if (overlayElements && typeof overlayElements.viewerLinkValue === 'string') {
    return overlayElements.viewerLinkValue;
  }
  return '';
}

function announceOverlayStatus(message, resetDelay = 1800) {
  if (!overlayElements || !overlayElements.status || !message) {
    return;
  }
  overlayElements.status.textContent = message;
  if (overlayStatusResetTimer) {
    clearTimeout(overlayStatusResetTimer);
  }
  overlayStatusResetTimer = setTimeout(() => {
    overlayStatusResetTimer = null;
    updateGameCaptureOverlay();
  }, resetDelay);
}

function copyOverlayViewerLink() {
  const link = getOverlayViewerLinkValue();
  if (!link) {
    announceOverlayStatus('Viewer link not ready yet.');
    return;
  }
  copyTextToClipboard(link)
    .then(() => announceOverlayStatus('Viewer link copied.'))
    .catch((error) => {
      console.warn('Unable to copy viewer link:', error);
      announceOverlayStatus('Unable to copy viewer link.');
    });
}

function openOverlayViewerLink() {
  const link = getOverlayViewerLinkValue();
  if (!link) {
    announceOverlayStatus('Viewer link not ready yet.');
    return;
  }
  try {
    window.open(link, '_blank', 'noopener');
    announceOverlayStatus('Viewer link opened.');
  } catch (error) {
    console.warn('Unable to open viewer link:', error);
    announceOverlayStatus('Unable to open viewer link.');
  }
}

function isMicMuted() {
  try {
    return !!(window.session && session.muted);
  } catch (error) {
    return false;
  }
}

function handleOverlayMuteClick() {
  if (typeof window.toggleMute === 'function') {
    try {
      window.toggleMute(true);
      setTimeout(updateOverlayMuteButtonState, 300);
      return;
    } catch (error) {
      console.warn('toggleMute failed:', error);
    }
  }
  announceOverlayStatus('Mute controls unavailable.');
}

function handleOverlayHangupClick() {
  if (typeof window.hangup === 'function') {
    try {
      window.hangup();
      return;
    } catch (error) {
      console.warn('hangup() failed:', error);
    }
  }
  if (window.session && typeof window.session.hangup === 'function') {
    try {
      window.session.hangup();
      return;
    } catch (error) {
      console.warn('session.hangup() failed:', error);
    }
  }
  handleOverlayReturnClick();
}

function updateOverlayMuteButtonState() {
  if (!overlayElements || !overlayElements.muteBtn) {
    return;
  }
  overlayElements.muteBtn.textContent = isMicMuted() ? 'Unmute mic' : 'Mute mic';
}

function deriveResolutionLabel(preset) {
  if (!preset) {
    return 'Auto';
  }
  const token = String(preset).toLowerCase();
  if (token.includes('uhd') || token.includes('1440')) {
    return '1440p';
  }
  if (token.includes('hq') || token.includes('1080')) {
    return '1080p';
  }
  if (token.includes('720')) {
    return '720p';
  }
  if (token.includes('480')) {
    return '480p';
  }
  return 'Auto';
}

function formatOverlayViewerLink(value) {
  if (!value) {
    return '—';
  }
  try {
    const url = new URL(value);
    const viewId = url.searchParams.get('view') || url.searchParams.get('push');
    if (viewId) {
      return `${url.hostname}/${viewId}`;
    }
    return url.hostname;
  } catch (error) {
    const text = String(value);
    return text.length > 42 ? `${text.slice(0, 39)}…` : text;
  }
}

function updateOverlayShareDetails(state) {
  if (!overlayElements) {
    return;
  }
  const profile = (state && state.shareProfile) || {};
  const shareLinks = profile.shareLinks || {};
  const viewerLink = shareLinks.view || '';
  overlayElements.viewerLinkValue = viewerLink;
  if (overlayElements.viewerLink) {
    overlayElements.viewerLink.textContent = formatOverlayViewerLink(viewerLink);
  }
  if (overlayElements.copyLinkBtn) {
    overlayElements.copyLinkBtn.disabled = !viewerLink;
  }
  if (overlayElements.openLinkBtn) {
    overlayElements.openLinkBtn.disabled = !viewerLink;
  }
  if (overlayElements.streamId) {
    overlayElements.streamId.textContent = profile.streamId ? formatOverlayValue(profile.streamId) : '—';
  }
  const qualitySummary = profile.qualitySummary || {};
  if (overlayElements.bitrate) {
    overlayElements.bitrate.textContent = qualitySummary.publishBitrateKbps
      ? `${qualitySummary.publishBitrateKbps} kbps`
      : '—';
  }
  if (overlayElements.viewBitrate) {
    overlayElements.viewBitrate.textContent = qualitySummary.viewBitrateKbps
      ? `${qualitySummary.viewBitrateKbps} kbps`
      : '—';
  }
  if (overlayElements.codec) {
    overlayElements.codec.textContent = qualitySummary.codec
      ? qualitySummary.codec.toUpperCase()
      : 'H264';
  }
  if (overlayElements.resolution) {
    overlayElements.resolution.textContent = deriveResolutionLabel(qualitySummary.preset);
  }
  if (overlayElements.viewers) {
    const viewerCount = state && typeof state.viewerCount === 'number' ? state.viewerCount : null;
    overlayElements.viewers.textContent = viewerCount !== null ? `${viewerCount}` : '—';
  }
}

function updateGameCaptureOverlay() {
  if (!overlayElements || !currentGameCaptureContext) {
    return;
  }
  const state = currentGameCaptureContext;
  overlayElements.status.textContent = deriveOverlayStatus(state);
  overlayElements.slot.textContent = formatOverlayValue(state.slotId);
  overlayElements.preset.textContent = formatOverlayValue(state.preset);
  overlayElements.cursor.textContent = formatOverlayCursor(state);
  if (state.appAudioTarget) {
    overlayElements.audio.textContent = formatOverlayValue(state.appAudioTarget);
  } else {
    overlayElements.audio.textContent = 'System';
  }
  overlayElements.transport.textContent = formatOverlayTransport(state.transportPreference);
  overlayElements.invite.textContent = truncateInviteLabel(state.activeInviteUrl || state.pendingInviteUrl || state.lastInviteUrl);
  updateOverlayShareDetails(state);
  updateOverlayMuteButtonState();
}

function formatOverlayCursor(state) {
  if (!state) {
    return 'Auto';
  }
  const normalized = normalizeCursorPreferenceValue(state.cursorPreference);
  if (normalized) {
    if (normalized === 'never') {
      return 'Hidden';
    }
    if (normalized === 'always') {
      return 'Visible';
    }
    return 'Motion';
  }
  if (state.mode === 'game') {
    return 'Hidden';
  }
  return 'Auto';
}

function formatOverlayValue(value) {
  if (value === null || value === undefined) {
    return '—';
  }
  const text = String(value);
  if (!text.trim().length) {
    return '—';
  }
  return text.length > 36 ? `${text.slice(0, 33)}…` : text;
}

function formatOverlayTransport(value) {
  if (value === true || value === 'whipout' || value === 'whip') {
    return 'WHIP relay';
  }
  if (value === false || value === 'p2p') {
    return 'P2P';
  }
  if (typeof value === 'string' && value.trim().length) {
    return value.trim().toUpperCase();
  }
  return 'Auto';
}

function truncateInviteLabel(value) {
  if (!value) {
    return '—';
  }
  try {
    const url = new URL(value);
    const last = `${url.host}${url.pathname}`;
    return last.length > 32 ? `${last.slice(0, 29)}…` : last;
  } catch (error) {
    const text = String(value);
    return text.length > 32 ? `${text.slice(0, 29)}…` : text;
  }
}

function deriveOverlayStatus(state) {
  if (!state) {
    return 'Waiting for invite…';
  }
  if (state.lastError) {
    return `Error: ${state.lastError}`;
  }
  if (state.pendingInviteUrl && !state.activeInviteUrl) {
    return 'Invite ready. Click Share to go live.';
  }
  if (state.activeInviteUrl) {
    return 'Capture interface ready. Share your game when prompted.';
  }
  return 'Preparing capture environment…';
}


var storedEle = null;
var PPTTimeout = null;
ipcRenderer.on('postMessage', (event, ...args) => {
	console.log(args);
	
	try {
		if (!doSomethingInWebApp){
			if (session && session.remoteInterfaceAPI){
				doSomethingInWebApp = session.remoteInterfaceAPI;
			}
		}
	}catch(e){}
	
	try {
		if ("record" in args[0]) {
			if (doSomethingInWebApp) {
			  console.log("doSomethingInWebApp");
			  var x = args[0].params.x;
			  var y = args[0].params.y;
			  var ele = document.elementFromPoint(x,y);
			  
			  if (ele.id){
				  var fauxEvent = {};
			      fauxEvent.data = {};
			      fauxEvent.data.record = ele.id;;
				  doSomethingInWebApp(fauxEvent);
			  }
			} else {
				console.log(doSomethingInWebApp);
				console.log(session.remoteInterfaceAPI);
				console.log("no doSomethingInWebApp");
			}
		}
		
		if ("hangup" in args[0]) {
			if (args[0].hangup == "estop"){
				if (doSomethingInWebApp) {
					console.log("HANG UP ESTOP1 ");
					var fauxEvent = {};
					fauxEvent.data = {};
					fauxEvent.data.hangup = "estop";
					doSomethingInWebApp(fauxEvent);
				} else {
					console.log("HANG UP ESTOP1 2");
					session.hangup(false, true); // no reload, estop=true
					console.log(session.remoteInterfaceAPI);
					console.log("no doSomethingInWebApp");
				}
			} else {
				if (doSomethingInWebApp) {
					console.log("HANG UP 1");
					var fauxEvent = {};
					fauxEvent.data = {};
					fauxEvent.data.close = true; // close and hangup are the same; close is compatible with older vdon versions tho. no estop tho.
					doSomethingInWebApp(fauxEvent);
				} else {
					console.log("HANG UP 2");
					session.hangup();
					console.log(session.remoteInterfaceAPI);
					console.log("no doSomethingInWebApp");
				}
			}
		}
		
		if (doSomethingInWebApp && ("mic" in args[0])){ // this is the new version.
			var fauxEvent = {};
			fauxEvent.data = {};
			fauxEvent.data.mic = args[0].mic 
			doSomethingInWebApp(fauxEvent);
			return;
		} else if ("micOld" in args[0]) { // this is for old pre v22 version
			if (session && (args[0].micOld === true)){ // unmute
				session.muted = false; // set
				toggleMute(true); // apply 
			} else if (session && (args[0].micOld === false)){ // mute
				session.muted = true; // set
				toggleMute(true); // apply
			} else if (args[0].micOld === "toggle") { // toggle
				toggleMute();
			}
			return;
		}
		
		if ("PPT" in args[0]){
			console.log(args[0].PPT);
			if (PPTTimeout){
				clearTimeout(PPTTimeout);
				PPTTimeout = setTimeout(function(node){
					PPTTimeout=null;
					if (node){
						session.muted = true;
						toggleMute(true);
						getById("mutebutton").classList.remove("PPTActive");
					} else if (doSomethingInWebApp){
						var fauxEvent = {};
						fauxEvent.data = {};
						fauxEvent.data.PPT = false;
						doSomethingInWebApp(fauxEvent);
					}
				},200, args[0].node);
			} else {
				if (args[0].node){
					session.muted = false;
					toggleMute(true);
					getById("mutebutton").classList.add("PPTActive");
				} else if (doSomethingInWebApp){
					var fauxEvent = {};
					fauxEvent.data = {};
					fauxEvent.data.PPT = true;
					doSomethingInWebApp(fauxEvent);
				}
				PPTTimeout = setTimeout(function(node){
					PPTTimeout=null;
					if (node){
						session.muted = true;
						toggleMute(true);
						getById("mutebutton").classList.remove("PPTActive");
					} else if (doSomethingInWebApp){
						var fauxEvent = {};
						fauxEvent.data = {};
						fauxEvent.data.PPT = false;
						doSomethingInWebApp(fauxEvent);
					}
				},600, args[0].node);
			}
			return;
		}
		
		if ("getDeviceList" in args[0]) {
			
			var x = args[0].params.x;
			var y = args[0].params.y;
			var ele = document.elementFromPoint(x,y);
			storedEle = ele;
			var menu = ele.dataset.menu;
			
			var response = {};
			response.menu = menu || false;
			response.eleId = ele.id || false;
			response.UUID = ele.dataset.UUID || false;
			response.params = args[0].params;
  
			if (typeof enumerateDevices === "function"){
				enumerateDevices().then(function(deviceInfos) {
					response.deviceInfos = deviceInfos;
					response = JSON.parse(JSON.stringify(response));
					ipcRenderer.send('deviceList', response);
				})
			} else {
				console.log("calling requestOutputAudioStream");
				requestOutputAudioStream().then(function(deviceInfos) {
					
					response.deviceInfos = deviceInfos;
					response = JSON.parse(JSON.stringify(response));
					ipcRenderer.send('deviceList', response);
					
					//deviceInfos = JSON.parse(JSON.stringify(deviceInfos));
					
					/* var output = [];
					for (var i=0;i<deviceInfos.length;i++){
						if (deviceInfos[i].kind === "audiooutput"){
							output.push(deviceInfos[i]);
						}
					} */
					
					console.log("Should only be audio output");
					//console.log(output);
					//ipcRenderer.send('deviceList', deviceInfos);
				})
			}
		}
		
		
		if ("changeVideoDevice" in args[0]) {
			changeVideoDeviceById(args[0].changeVideoDevice);
		}
		
		if ("nativeList" in args[0]){
			//console.log("nativeList got");
			event.returnValue = true;
		}
		
		if ("changeAudioDevice" in args[0]) {
			changeAudioDeviceById(args[0].changeAudioDevice);
		}
		
		if ("changeAudioOutputDevice" in args[0]) {
			//args[0].data.menu = menu || false;
			//args[0].data.eleId = ele.id || false;
			//args[0].data.UUID = ele.dataset.UUID || false;
			//args[0].deviceInfos;
			//args[0].data.params = params;
			if ("data" in args[0]){
				setSink(storedEle, args[0].changeAudioOutputDevice);
				storedEle.manualSink = args[0].changeAudioOutputDevice;
				//storedEle.manualSink = args[0].changeAudioOutputDevice;
			} else if (typeof changeAudioOutputDeviceById === "function"){
				changeAudioOutputDeviceById(args[0].changeAudioOutputDevice);
			} else {
				changeAudioOutputDeviceByIdThirdParty(args[0].changeAudioOutputDevice);
			}
			storedEle = null;
		} 
	} catch(e){
		console.error(e);
	}
})


function setSink(ele, id){
	ele.setSinkId(id).then(() => {
		console.log("New Output Device:" + id);
	}).catch(error => {
		console.error(error);
	});
}

function changeAudioOutputDeviceByIdThirdParty(deviceID){
	console.log("Output deviceID: "+deviceID);
	
	document.querySelectorAll("audio, video").forEach(ele=>{
		try {
			if (ele.manualSink){
				setSink(ele,ele.manualSink);
			} else {
				setSink(ele,deviceID);
			}
		} catch(e){}
	});
	document.querySelectorAll('iframe').forEach( item =>{
		try{
			item.contentWindow.document.body.querySelectorAll("audio, video").forEach(ele=>{
				try {
					if (ele.manualSink){
						setSink(ele,ele.manualSink);
					} else {
						setSink(ele,deviceID);
					}
				} catch(e){}
			});
		} catch(e){}
	});	
	
}

function enumerateDevicesThirdParty() {
	if (typeof navigator.enumerateDevices === "function") {
		return navigator.enumerateDevices();
	} else if (typeof navigator.mediaDevices === "object" && typeof navigator.mediaDevices.enumerateDevices === "function") {
		return navigator.mediaDevices.enumerateDevices();
	} else {
		return new Promise((resolve, reject) => {
			try {
				if (window.MediaStreamTrack == null || window.MediaStreamTrack.getSources == null) {
					throw new Error();
				}
				window.MediaStreamTrack.getSources((devices) => {
					resolve(devices
						.filter(device => {
							return device.kind.toLowerCase() === "video" || device.kind.toLowerCase() === "videoinput";
						})
						.map(device => {
							return {
								deviceId: device.deviceId != null ? device.deviceId : ""
								, groupId: device.groupId
								, kind: "videoinput"
								, label: device.label
								, toJSON: /*  */ function() {
									return this;
								}
							};
						}));
				});
			} catch (e) {}
		});
	}
}

function requestOutputAudioStream() {
	console.log("requestOutputAudioStream");
	return navigator.mediaDevices.getUserMedia({audio: true, video: false}).then(function(stream) { // Apple needs thi to happen before I can access EnumerateDevices. 
		return enumerateDevicesThirdParty().then(function(deviceInfos) {
			console.log("enumerateDevicesThirdParty");
			stream.getTracks().forEach(function(track) { // We don't want to keep it without audio; so we are going to try to add audio now.
				track.stop(); // I need to do this after the enumeration step, else it breaks firefox's labels
			});
			console.log(deviceInfos);
			return deviceInfos;
		});
	});
}
