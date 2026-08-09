'use strict';

function normalizeCapturePreferences(preferences) {
  const requestedDelay = Number(preferences && preferences.playoutDelay);
  return {
    hideCursorCapture: Boolean(preferences && preferences.hideCursorCapture),
    playoutDelay: Number.isFinite(requestedDelay)
      ? Math.min(600, Math.max(0, requestedDelay))
      : 0,
    disableAdaptiveScaling: Boolean(preferences && preferences.disableAdaptiveScaling),
    lockResolution: Boolean(preferences && preferences.lockResolution),
    lockFramerate: Boolean(preferences && preferences.lockFramerate)
  };
}

function serializeCapturePreferences(preferences) {
  return encodeURIComponent(JSON.stringify(normalizeCapturePreferences(preferences)));
}

function resolveWindowCapturePreferences(windowInstance, fallbackPreferences) {
  const source = windowInstance && windowInstance.args && typeof windowInstance.args === 'object'
    ? windowInstance.args
    : fallbackPreferences;
  return normalizeCapturePreferences(source);
}

module.exports = {
  normalizeCapturePreferences,
  resolveWindowCapturePreferences,
  serializeCapturePreferences
};
