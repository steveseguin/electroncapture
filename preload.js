// preload.js
const { ipcRenderer, contextBridge } = require('electron');

// Native modules - try direct require first (works when sandbox disabled),
// fall back to IPC-based approach when in sandbox mode.

let WindowAudioStream = null;
let ElectronAsio = null;
let useIpcForWindowAudio = false;
let useIpcForAsio = false;

// Try loading WindowAudioStream directly (sandbox disabled mode)
try {
  WindowAudioStream = require('./window-audio-stream.js');
  if (WindowAudioStream && typeof WindowAudioStream !== 'function' && WindowAudioStream.default) {
    WindowAudioStream = WindowAudioStream.default;
  }
  console.log('[Electron Capture] WindowAudioStream loaded directly');
} catch (error) {
  // Sandbox mode - use IPC fallback
  useIpcForWindowAudio = true;
  console.log('[Electron Capture] WindowAudioStream will use IPC (sandbox mode)');
}

// Try loading ElectronAsio directly (sandbox disabled mode, Windows only)
if (process.platform === 'win32') {
  try {
    ElectronAsio = require('./native-modules/electron-asio/index.js');
    if (ElectronAsio && ElectronAsio.initialize) {
      ElectronAsio.initialize();
      console.log('[Electron Capture] ASIO module loaded directly:', ElectronAsio.getVersionInfo());
    }
  } catch (error) {
    // Sandbox mode - use IPC fallback
    useIpcForAsio = true;
    console.log('[Electron Capture] ASIO will use IPC (sandbox mode)');
  }
}

const WINDOW_AUDIO_EVENT_CHANNEL = 'windowAudioStreamData';
const APP_AUDIO_PARAM_NAMES = ['appaudio', 'appAudio', 'appAudioTarget'];

let appAudioTarget = null;
let windowAudioStreamInstance = null;
let displayMediaHookInstalled = false;

const encoderPreferences = {
  defaultMode: 'hardware',
  preferredMode: 'hardware',
  codecPreference: 'auto',
  maxBitrate: 0
};

// Custom Electron capture preferences (v39.2.7+)
const capturePreferences = {
  hideCursorCapture: false,
  playoutDelay: 0,
  disableAdaptiveScaling: false,
  lockResolution: false,
  lockFramerate: false
};

// Load capture preferences from main process
ipcRenderer.invoke('capture:get-preferences').then((prefs) => {
  if (prefs) {
    Object.assign(capturePreferences, prefs);
    if (capturePreferences.hideCursorCapture) {
      console.log('[Electron Capture] Cursor suppression enabled for screen capture');
    }
    if (capturePreferences.playoutDelay > 0) {
      console.log('[Electron Capture] Default playout delay:', capturePreferences.playoutDelay, 'seconds');
    }
  }
}).catch((err) => {
  console.warn('[Electron Capture] Failed to load capture preferences:', err);
});

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

const DEFAULT_DRAG_REGION_PREF_CHANNEL = 'drag-region:get-default-preference';
const DEFAULT_DRAG_REGION_CONFIG = {
  elementId: '__electron_capture_default_drag_handle',
  styleId: '__electron_capture_default_drag_handle_style',
  datasetKey: 'electronCaptureDefaultDragRegion',
  detectionDebounce: 250,
  pollInterval: 4000
};

function initDefaultDragRegionFallback() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }

  const state = {
    observer: null,
    debounceHandle: null,
    pollHandle: null,
    hasCustomRegion: false,
    fallbackVisible: false,
    initialized: false
  };

  const ensureStyleElement = () => {
    if (document.getElementById(DEFAULT_DRAG_REGION_CONFIG.styleId)) {
      return;
    }
    const style = document.createElement('style');
    style.id = DEFAULT_DRAG_REGION_CONFIG.styleId;
    style.textContent = `
      #${DEFAULT_DRAG_REGION_CONFIG.elementId} {
        position: fixed;
        top: env(safe-area-inset-top, 0px);
        left: 0;
        width: 100%;
        height: 20px;
        z-index: 2147483647;
        background: transparent;
        pointer-events: auto;
        -webkit-app-region: drag;
        -webkit-user-select: none;
        user-select: none;
        cursor: grab;
      }

      #${DEFAULT_DRAG_REGION_CONFIG.elementId}:active {
        cursor: grabbing;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  };

  const getFallbackElement = () => document.getElementById(DEFAULT_DRAG_REGION_CONFIG.elementId);

  const ensureFallbackElement = () => {
    if (!document.body) {
      return null;
    }
    let element = getFallbackElement();
    if (!element) {
      element = document.createElement('div');
      element.id = DEFAULT_DRAG_REGION_CONFIG.elementId;
      element.dataset[DEFAULT_DRAG_REGION_CONFIG.datasetKey] = 'true';
      element.setAttribute('role', 'presentation');
      element.setAttribute('aria-hidden', 'true');
      element.textContent = '';
      document.body.appendChild(element);
    } else if (!element.parentElement) {
      document.body.appendChild(element);
    }
    state.fallbackVisible = true;
    return element;
  };

  const removeFallbackElement = () => {
    const element = getFallbackElement();
    if (element && element.parentElement) {
      element.parentElement.removeChild(element);
    }
    state.fallbackVisible = false;
  };

  const isDefaultFallbackElement = (node) => {
    if (!node) {
      return false;
    }
    if (node.dataset && node.dataset[DEFAULT_DRAG_REGION_CONFIG.datasetKey]) {
      return true;
    }
    if (node.id && node.id === DEFAULT_DRAG_REGION_CONFIG.elementId) {
      return true;
    }
    return false;
  };

  const elementHasUsableDragRegion = (node) => {
    if (!node || isDefaultFallbackElement(node)) {
      return false;
    }
    let style = null;
    try {
      style = window.getComputedStyle(node);
    } catch (error) {
      return false;
    }
    if (!style) {
      return false;
    }
    const region = style.getPropertyValue('-webkit-app-region');
    if (!region || region.trim() !== 'drag') {
      return false;
    }

    if (style.getPropertyValue('pointer-events') === 'none') {
      return false;
    }
    if (style.getPropertyValue('display') === 'none' || style.getPropertyValue('visibility') === 'hidden') {
      return false;
    }
    const opacity = parseFloat(style.getPropertyValue('opacity') || '1');
    if (Number.isFinite(opacity) && opacity === 0) {
      return false;
    }

    if (node instanceof window.HTMLElement) {
      if (node.offsetWidth > 0 && node.offsetHeight > 0) {
        return true;
      }
    }

    if (typeof node.getClientRects === 'function') {
      const rects = node.getClientRects();
      if (rects && rects.length) {
        const rect = rects[0];
        if (rect.width > 0 && rect.height > 0) {
          return true;
        }
      }
    }
    return false;
  };

  const detectCustomDragRegion = () => {
    if (!document.documentElement) {
      return false;
    }
    const walker = document.createTreeWalker(
      document.documentElement,
      NodeFilter.SHOW_ELEMENT,
      null,
      false
    );
    let current = walker.currentNode;
    if (current && elementHasUsableDragRegion(current)) {
      return true;
    }
    while (walker.nextNode()) {
      current = walker.currentNode;
      if (elementHasUsableDragRegion(current)) {
        return true;
      }
    }
    return false;
  };

  const applyDragRegionState = (hasCustomRegion) => {
    if (hasCustomRegion) {
      if (state.fallbackVisible) {
        removeFallbackElement();
      }
    } else {
      ensureStyleElement();
      ensureFallbackElement();
    }
  };

  const evaluateDragRegionState = () => {
    try {
      const hasCustomRegion = detectCustomDragRegion();
      if (hasCustomRegion === state.hasCustomRegion) {
        return;
      }
      state.hasCustomRegion = hasCustomRegion;
      applyDragRegionState(hasCustomRegion);
    } catch (error) {
      console.warn('Electron Capture drag region detection failed:', error);
    }
  };

  const scheduleEvaluation = () => {
    if (state.debounceHandle) {
      return;
    }
    state.debounceHandle = window.setTimeout(() => {
      state.debounceHandle = null;
      evaluateDragRegionState();
    }, DEFAULT_DRAG_REGION_CONFIG.detectionDebounce);
  };

  const attachMutationObserver = () => {
    if (state.observer || !document.documentElement) {
      return;
    }
    state.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' || mutation.type === 'childList') {
          scheduleEvaluation();
          break;
        }
      }
    });
    state.observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true
    });
  };

  const cleanup = () => {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (state.debounceHandle) {
      window.clearTimeout(state.debounceHandle);
      state.debounceHandle = null;
    }
    if (state.pollHandle) {
      window.clearInterval(state.pollHandle);
      state.pollHandle = null;
    }
    window.removeEventListener('beforeunload', cleanup);
    window.removeEventListener('focus', scheduleEvaluation);
    window.removeEventListener('resize', scheduleEvaluation);
  };

  const startPolling = () => {
    if (state.pollHandle) {
      return;
    }
    state.pollHandle = window.setInterval(() => {
      evaluateDragRegionState();
    }, DEFAULT_DRAG_REGION_CONFIG.pollInterval);
  };

  const start = () => {
    if (state.initialized) {
      return;
    }
    if (!document.body) {
      window.setTimeout(start, 0);
      return;
    }
    state.initialized = true;
    ensureStyleElement();
    ensureFallbackElement();
    evaluateDragRegionState();
    attachMutationObserver();
    startPolling();
    window.addEventListener('beforeunload', cleanup);
    window.addEventListener('focus', scheduleEvaluation);
    window.addEventListener('resize', scheduleEvaluation);
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
}

function isDefaultDragRegionDisabledViaEnv() {
  const envValue = (process?.env?.ELECTRON_CAPTURE_DISABLE_DEFAULT_DRAG_REGION || '').trim();
  if (!envValue.length) {
    return false;
  }
  return /^(1|true|yes|on)$/i.test(envValue);
}

function bootstrapDefaultDragRegionFallback() {
  if (isDefaultDragRegionDisabledViaEnv()) {
    return;
  }
  if (!ipcRenderer || typeof ipcRenderer.invoke !== 'function') {
    initDefaultDragRegionFallback();
    return;
  }
  ipcRenderer.invoke(DEFAULT_DRAG_REGION_PREF_CHANNEL)
    .then((enabled) => {
      if (enabled === false) {
        return;
      }
      initDefaultDragRegionFallback();
    })
    .catch((error) => {
      console.warn('Default drag-region preference unavailable; enabling fallback by default.', error);
      initDefaultDragRegionFallback();
    });
}

bootstrapDefaultDragRegionFallback();

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

function installDisplayMediaHook() {
  if (displayMediaHookInstalled) {
    return;
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
    return;
  }

  const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);

  navigator.mediaDevices.getDisplayMedia = async (...args) => {
    // Apply cursor suppression if enabled and not already specified
    if (capturePreferences.hideCursorCapture && args.length > 0 && args[0]) {
      const constraints = args[0];
      if (constraints.video && typeof constraints.video === 'object') {
        if (typeof constraints.video.cursor === 'undefined') {
          constraints.video.cursor = 'never';
          console.log('[Electron Capture] Applied cursor suppression to getDisplayMedia');
        }
      } else if (constraints.video === true) {
        constraints.video = { cursor: 'never' };
        console.log('[Electron Capture] Applied cursor suppression to getDisplayMedia');
      }
    }

    const stream = await originalGetDisplayMedia(...args);
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
    'isWindowAudioCaptureAvailable': () => {
      // Direct mode: check module loaded
      if (!useIpcForWindowAudio) return Boolean(WindowAudioStream);
      // IPC mode: assume available if main process loaded it (async check done at startup)
      return true; // Actual availability checked via windowAudio:getTargets
    },
    'isWindowAudioCaptureAvailableAsync': async () => {
      if (!useIpcForWindowAudio) return Boolean(WindowAudioStream);
      try {
        const result = await ipcRenderer.invoke('windowAudio:getTargets');
        return result && result.success !== false;
      } catch { return false; }
    },
    // Custom Electron capture preferences (v39.2.7+)
    'getCapturePreferences': () => ({ ...capturePreferences }),
    'getPlayoutDelay': () => capturePreferences.playoutDelay,
    'isAdaptiveScalingDisabled': () => capturePreferences.disableAdaptiveScaling,
    'isCursorSuppressionEnabled': () => capturePreferences.hideCursorCapture,
    // Helper to apply playout delay to an RTCRtpReceiver
    'applyPlayoutDelay': (receiver, delaySeconds) => {
      const delay = typeof delaySeconds === 'number' ? delaySeconds : capturePreferences.playoutDelay;
      if (receiver && typeof receiver.playoutDelayHint !== 'undefined' && delay > 0) {
        receiver.playoutDelayHint = delay;
        console.log('[Electron Capture] Applied playout delay:', delay, 'seconds');
        return true;
      }
      return false;
    },
    // ASIO Audio Capture (Windows only) - supports both direct and IPC modes
    'isAsioAvailable': () => {
      if (!useIpcForAsio) {
        return Boolean(ElectronAsio && ElectronAsio.isAvailable && ElectronAsio.isAvailable());
      }
      // IPC mode: return false synchronously, use async version for accurate check
      return false;
    },
    'isAsioAvailableAsync': async () => {
      if (!useIpcForAsio) {
        return Boolean(ElectronAsio && ElectronAsio.isAvailable && ElectronAsio.isAvailable());
      }
      try {
        return await ipcRenderer.invoke('asio:isAvailable');
      } catch { return false; }
    },
    'getAsioDevices': () => {
      if (!useIpcForAsio) return ElectronAsio ? ElectronAsio.getDevices() : [];
      console.warn('getAsioDevices: Use getAsioDevicesAsync in sandbox mode');
      return [];
    },
    'getAsioDevicesAsync': async () => {
      if (!useIpcForAsio) return ElectronAsio ? ElectronAsio.getDevices() : [];
      try {
        return await ipcRenderer.invoke('asio:getDevices');
      } catch { return []; }
    },
    'getAsioDeviceInfo': (deviceIndex) => {
      if (!useIpcForAsio) return ElectronAsio ? ElectronAsio.getDeviceInfo(deviceIndex) : null;
      console.warn('getAsioDeviceInfo: Use getAsioDeviceInfoAsync in sandbox mode');
      return null;
    },
    'getAsioDeviceInfoAsync': async (deviceIndex) => {
      if (!useIpcForAsio) return ElectronAsio ? ElectronAsio.getDeviceInfo(deviceIndex) : null;
      try {
        return await ipcRenderer.invoke('asio:getDeviceInfo', deviceIndex);
      } catch { return null; }
    },
    'getAsioVersionInfo': () => {
      if (!useIpcForAsio) return ElectronAsio ? ElectronAsio.getVersionInfo() : 'ASIO not available';
      return 'ASIO (IPC mode)';
    },
    'getAsioVersionInfoAsync': async () => {
      if (!useIpcForAsio) return ElectronAsio ? ElectronAsio.getVersionInfo() : 'ASIO not available';
      try {
        return await ipcRenderer.invoke('asio:getVersionInfo');
      } catch { return 'ASIO not available'; }
    },
    'createAsioStream': (options) => {
      if (!useIpcForAsio) {
        if (!ElectronAsio || !ElectronAsio.AsioStream) {
          throw new Error('ASIO module not available');
        }
        return new ElectronAsio.AsioStream(options);
      }
      throw new Error('createAsioStream: Use createAsioStreamAsync in sandbox mode');
    },
    'createAsioStreamAsync': async (options) => {
      if (!useIpcForAsio) {
        if (!ElectronAsio || !ElectronAsio.AsioStream) {
          throw new Error('ASIO module not available');
        }
        return new ElectronAsio.AsioStream(options);
      }
      // IPC mode: create stream in main process, return control object
      try {
        const streamInfo = await ipcRenderer.invoke('asio:createStream', options);
        return {
          streamId: streamInfo.streamId,
          inputLatency: streamInfo.inputLatency,
          outputLatency: streamInfo.outputLatency,
          sampleRate: streamInfo.sampleRate,
          bufferSize: streamInfo.bufferSize,
          start: () => ipcRenderer.invoke('asio:startStream', streamInfo.streamId),
          stop: () => ipcRenderer.invoke('asio:stopStream', streamInfo.streamId),
          close: () => ipcRenderer.invoke('asio:closeStream', streamInfo.streamId),
          getStats: () => ipcRenderer.invoke('asio:getStreamStats', streamInfo.streamId),
          write: (buffers) => {
            const serialized = buffers.map(buf => Array.from(buf));
            return ipcRenderer.invoke('asio:writeStream', streamInfo.streamId, serialized);
          }
        };
      } catch (err) {
        throw new Error('Failed to create ASIO stream: ' + err.message);
      }
    },
    // Subscribe to ASIO audio data (IPC mode only)
    'onAsioAudioData': (callback) => {
      const handler = (event, { streamId, buffers }) => {
        const float32Buffers = buffers.map(arr => new Float32Array(arr));
        callback(streamId, float32Buffers);
      };
      ipcRenderer.on('asio:audioData', handler);
      return () => ipcRenderer.removeListener('asio:audioData', handler);
    },
    'onAsioError': (callback) => {
      const handler = (event, { streamId, error }) => callback(streamId, error);
      ipcRenderer.on('asio:error', handler);
      return () => ipcRenderer.removeListener('asio:error', handler);
    }
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
      if (ElectronAsio) {
        contextBridge.exposeInMainWorld('ElectronAsio', ElectronAsio);
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
      if (ElectronAsio) {
        window.ElectronAsio = ElectronAsio;
      }
    } catch (error) {
      console.error('Failed to attach APIs to window:', error);
    }
  } else {
    // Provide a mirror on window as well for compatibility when contextIsolation is enabled.
    if (WindowAudioStream) {
      try {
        window.WindowAudioStream = WindowAudioStream;
      } catch (error) {
        // Ignore - window may not be writable in some sandboxed contexts.
      }
    }
    if (ElectronAsio) {
      try {
        window.ElectronAsio = ElectronAsio;
      } catch (error) {
        // Ignore - window may not be writable in some sandboxed contexts.
      }
    }
  }
})();

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
