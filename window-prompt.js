'use strict';

const promptPins = new WeakMap();

function suspendWindowPin(window) {
  let state = promptPins.get(window);
  if (!state) {
    state = { count: 0, onTop: window.isAlwaysOnTop() };
    if (state.onTop) window.setAlwaysOnTop(false);
    promptPins.set(window, state);
  }
  state.count++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--state.count > 0) return;
    promptPins.delete(window);
    try {
      if (state.onTop && !window.isDestroyed()) window.setAlwaysOnTop(true);
    } catch (error) {
      console.warn('Unable to restore window pin after dialog:', error);
    }
  };
}

async function showWindowPrompt(window, prompt, options, apply) {
  if (window.isDestroyed()) return;
  let restorePin;
  try {
    restorePin = suspendWindowPin(window);
    const result = await prompt({ ...options(), resizable: true, type: 'input', alwaysOnTop: true });
    if (result !== null && result !== undefined && !window.isDestroyed()) await apply(result);
  } catch (error) {
    console.warn('Window editing dialog failed:', error);
  } finally {
    restorePin?.();
  }
}

module.exports = { showWindowPrompt, suspendWindowPin };
