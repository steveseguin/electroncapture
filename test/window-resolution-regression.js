'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { parseResolution, physicalResolution, resizeWindow } = require('../window-resolution');

assert.deepEqual(parseResolution(' 1920 X 1080 '), { width: 1920, height: 1080 });
assert.deepEqual(parseResolution('640×360'), { width: 640, height: 360 });
for (const value of ['0x720', '-1x720', '1280x', '1.5x720', '1280x720junk', '9999999999999999x720']) {
  assert.equal(parseResolution(value), null);
}
let size = [640, 360], full = false, maximized = false;
const window = Object.assign(new EventEmitter(), {
  args: {}, isDestroyed: () => false, getSize: () => size,
  isFullScreen: () => full, isMaximized: () => maximized,
  setFullScreen: () => {}, unmaximize: () => { maximized = false; },
  setSize: (width, height) => { size = [width, height]; },
});
const scale = () => 2;
assert.equal(physicalResolution(window, scale), '1280x720');
const unchanged = parseResolution(physicalResolution(window, scale));
resizeWindow(window, unchanged.width, unchanged.height, scale);
assert.deepEqual(size, [640, 360], 'accepting the displayed resolution must not shrink a high-DPI window');
assert.equal(window.args.width, 1280);
assert.equal(window.args.w, 1280);
maximized = true;
resizeWindow(window, 1920, 1080, scale);
assert.equal(maximized, false);
assert.deepEqual(size, [960, 540]);
full = true;
resizeWindow(window, 1280, 720, scale);
resizeWindow(window, 640, 360, scale);
assert.deepEqual(size, [960, 540], 'wait for fullscreen exit before resizing');
full = false;
window.emit('leave-full-screen');
assert.deepEqual(size, [320, 180], 'latest resize replaces a pending request');
assert.equal(window.args.fullscreen, false);
assert.equal(window.listenerCount('closed'), 0);
full = true;
resizeWindow(window, 1920, 1080, scale);
window.emit('closed');
assert.equal(window.listenerCount('leave-full-screen'), 0);
console.log('Window resolution regression checks passed');
