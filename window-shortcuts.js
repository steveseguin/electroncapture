'use strict';

function pushToTalkAccelerator(value) {
  if (!value || typeof value.key !== 'string' || !value.key) return null;
  const parts = [];
  if (value.ctrl) parts.push('CommandOrControl');
  if (value.alt) parts.push('Alt');
  if (value.shift) parts.push('Shift');
  if (value.meta) parts.push('Meta');
  const namedKeys = ['Space', 'Backspace', 'Tab', 'Capslock', 'Return', 'Enter',
    'Plus', 'Numlock', 'Scrolllock', 'Delete', 'Insert', 'Up', 'Down', 'Left',
    'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Esc', 'VolumeUp',
    'VolumeDown', 'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop',
    'MediaPlayPause', 'PrintScreen', 'num0', 'num1', 'num2', 'num3', 'num4',
    'num5', 'num6', 'num7', 'num8', 'num9', 'numdec', 'numadd', 'numsub',
    'nummult', 'numdiv'];
  const key = value.key === '+' ? 'Plus' : value.key === ' ' ? 'Space' :
    namedKeys.find(key => key.toLowerCase() === value.key.toLowerCase()) || value.key.toUpperCase();
  parts.push(key);
  return parts.join('+');
}

function acceleratorKey(accelerator, platform) {
  const parts = accelerator.toLowerCase().split('+');
  const aliases = {
    commandorcontrol: platform === 'darwin' ? 'command' : 'control',
    cmdorctrl: platform === 'darwin' ? 'command' : 'control',
    ctrl: 'control', cmd: 'command', option: 'alt', return: 'enter',
    meta: platform === 'darwin' ? 'command' : 'meta',
  };
  return parts.map(part => aliases[part] || part).sort().join('+');
}

function createWindowShortcuts(globalShortcut, platform = process.platform) {
  const windows = new Map();
  const accelerators = new Map();

  function register(entry) {
    if (entry.registered) return true;
    try {
      entry.registered = globalShortcut.register(entry.accelerator, () => {
        // Keep the existing ownership order when retrying an OS conflict.
        const candidates = [...entry.bindings].reverse();
        const target = candidates.find(candidate => !candidate.window.isDestroyed());
        if (target) target.callback();
      });
    } catch (error) {
      console.warn('Unable to register shortcut:', entry.accelerator, error.message);
    }
    return entry.registered;
  }

  function retry(window) {
    if (window.isDestroyed()) return;
    const entries = new Set();
    for (const binding of windows.get(window)?.values() || []) {
      const entry = accelerators.get(binding.key);
      if (entry && !entry.registered) entries.add(entry);
    }
    for (const entry of entries) register(entry);
  }

  function remove(window, slot) {
    const bindings = windows.get(window);
    const binding = bindings?.get(slot);
    if (!binding) return;
    bindings.delete(slot);
    const entry = accelerators.get(binding.key);
    entry.bindings.delete(binding);
    if (!entry.bindings.size) {
      if (entry.registered) globalShortcut.unregister(entry.accelerator);
      accelerators.delete(binding.key);
    }
  }

  function set(window, slot, accelerator, callback) {
    if (window.isDestroyed()) return false;
    remove(window, slot);
    if (!accelerator) return true;
    let bindings = windows.get(window);
    if (!bindings) {
      bindings = new Map();
      windows.set(window, bindings);
      window.once('closed', () => {
        for (const slot of [...bindings.keys()]) remove(window, slot);
        windows.delete(window);
      });
    }
    const key = acceleratorKey(accelerator, platform);
    let entry = accelerators.get(key);
    if (!entry) {
      entry = { accelerator, bindings: new Set(), registered: false };
      accelerators.set(key, entry);
    }
    const binding = { key, window, callback };
    bindings.set(slot, binding);
    entry.bindings.add(binding);
    return register(entry);
  }

  return { set, remove, retry };
}

module.exports = { createWindowShortcuts, pushToTalkAccelerator };
