'use strict';
const fs = require('fs');
const { randomUUID } = require('crypto');

function validBounds(bounds) {
  return !!bounds && ['x', 'y', 'width', 'height'].every(key =>
    Number.isSafeInteger(bounds[key]) && bounds[key] >= -2147483648 && bounds[key] <= 2147483647
  ) && bounds.width > 0 && bounds.height > 0;
}

function createBoundsStore(file, io = fs) {
  return {
    load() {
      try {
        const bounds = JSON.parse(io.readFileSync(file, 'utf8'));
        return validBounds(bounds) ? bounds : null;
      } catch { return null; }
    },
    save(bounds) {
      if (!validBounds(bounds)) return false;
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        io.writeFileSync(temporary, JSON.stringify(bounds));
        io.renameSync(temporary, file);
        return true;
      } catch (error) {
        console.warn('Unable to save window bounds:', error.message);
        return false;
      } finally {
        try { io.unlinkSync(temporary); } catch { /* Already renamed or never created. */ }
      }
    },
  };
}

function installBoundsPersistence(window, save, delay = 500) {
  let timer = null;
  const flush = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    if (!window.isDestroyed() && !window.isMinimized() && !window.isMaximized() && !window.isFullScreen()) {
      save(window.getBounds());
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  };
  window.on('resize', schedule);
  window.on('move', schedule);
  window.on('close', flush);
  window.once('closed', () => {
    clearTimeout(timer);
    timer = null;
    window.removeListener('resize', schedule);
    window.removeListener('move', schedule);
    window.removeListener('close', flush);
  });
}

module.exports = { createBoundsStore, installBoundsPersistence };
