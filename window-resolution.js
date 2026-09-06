'use strict';

function parseResolution(value) {
  const match = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/i.exec(String(value));
  if (!match) return null;
  const [width, height] = [Number(match[1]), Number(match[2])];
  return [width, height].every(size => Number.isInteger(size) && size > 0 && size <= 2147483647)
    ? { width, height } : null;
}

function physicalResolution(window, getScale) {
  const factor = getScale(window);
  return window.getSize().map(size => Math.round(size * factor)).join('x');
}

const pending = new WeakMap();
function resizeWindow(window, width, height, getScale) {
  if (window.isDestroyed() || !parseResolution(`${width}x${height}`)) return;
  pending.get(window)?.();
  const apply = () => {
    cleanup();
    if (window.isDestroyed()) return;
    try {
      const factor = getScale(window);
      if (!Number.isFinite(factor) || factor <= 0) return;
      if (window.isMaximized()) window.unmaximize();
      window.setSize(Math.max(1, Math.round(width / factor)), Math.max(1, Math.round(height / factor)));
      Object.assign(window.args, { width, w: width, height, h: height, fullscreen: false, f: false });
      window.full = false;
    } catch (error) {
      console.warn('Unable to resize window:', error);
    }
  };
  const cleanup = () => {
    window.removeListener('leave-full-screen', apply);
    window.removeListener('closed', cleanup);
    pending.delete(window);
  };
  if (window.isFullScreen()) {
    pending.set(window, cleanup);
    window.once('leave-full-screen', apply);
    window.once('closed', cleanup);
    try { window.setFullScreen(false); }
    catch (error) { cleanup(); console.warn('Unable to exit fullscreen:', error); }
  } else {
    // Transparent Windows windows can fill the display while Electron reports
    // false. The app tracks this state for its fullscreen menu and shortcuts.
    if (window.full) {
      try { window.setFullScreen(false); }
      catch (error) { console.warn('Unable to exit fullscreen:', error); return; }
    }
    apply();
  }
}

module.exports = { parseResolution, physicalResolution, resizeWindow };
