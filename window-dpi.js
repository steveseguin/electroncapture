'use strict';

function installWindowDpi(window, screen, getScaleFactor) {
  const contents = window.webContents;
  let appliedZoom = null;
  const update = (force = false) => {
    if (window.isDestroyed() || contents.isDestroyed()) return;
    try {
      if (window.args.nodpi) {
        // Leave manually controlled zoom alone unless disabling compensation
        // that this controller previously applied.
        if (appliedZoom !== null) contents.setZoomFactor(1);
        appliedZoom = null;
        return;
      }
      const scale = getScaleFactor(window);
      if (!Number.isFinite(scale) || scale <= 0) return;
      const zoom = 1 / scale;
      if (force || zoom !== appliedZoom) {
        contents.setZoomFactor(zoom);
        appliedZoom = zoom;
      }
    } catch (error) {
      console.warn('Failed to apply DPI compensation:', error);
    }
  };
  const onMove = () => update();
  const onNavigate = () => update(true);
  const onMetrics = (_event, _display, metrics) => {
    if (metrics.includes('scaleFactor') || metrics.includes('bounds')) update();
  };
  window.on('move', onMove);
  contents.on('did-finish-load', onNavigate);
  contents.on('did-navigate', onNavigate);
  screen.on('display-metrics-changed', onMetrics);
  window.once('closed', () => {
    screen.removeListener('display-metrics-changed', onMetrics);
    window.removeListener('move', onMove);
    contents.removeListener('did-finish-load', onNavigate);
    contents.removeListener('did-navigate', onNavigate);
  });
  return update;
}

module.exports = { installWindowDpi };
