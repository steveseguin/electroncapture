'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installWindowDpi } = require('../window-dpi');

const screen = new EventEmitter();
const applied = [];
let scale = 2;
const window = Object.assign(new EventEmitter(), {
  args: { nodpi: false }, isDestroyed: () => false,
  webContents: Object.assign(new EventEmitter(), {
    isDestroyed: () => false, setZoomFactor: value => applied.push(value),
  }),
});
const update = installWindowDpi(window, screen, () => scale);
window.webContents.emit('did-finish-load');
assert.deepEqual(applied, [0.5]);
window.emit('move');
assert.equal(applied.length, 1, 'moving within the same scale does not repeatedly override zoom');
scale = 1;
window.emit('move');
assert.equal(applied.at(-1), 1, 'returning to standard DPI resets compensation');
scale = 1.5;
screen.emit('display-metrics-changed', {}, {}, ['scaleFactor']);
assert.equal(applied.at(-1), 1 / 1.5);
window.args.nodpi = true;
update();
assert.equal(applied.at(-1), 1, 'disabling compensation removes the previous scale');
const count = applied.length;
window.emit('move');
window.webContents.emit('did-finish-load');
assert.equal(applied.length, count, 'nodpi leaves subsequent user zoom alone');
window.args.nodpi = false;
update();
assert.equal(applied.at(-1), 1 / 1.5, 'enabling compensation on a reused window applies immediately');
scale = NaN;
window.emit('move');
assert.equal(applied.at(-1), 1 / 1.5);
const contents = window.webContents;
Object.defineProperty(window, 'webContents', { get() { throw new Error('Object has been destroyed'); } });
window.emit('closed');
assert.equal(screen.listenerCount('display-metrics-changed'), 0);
assert.equal(window.listenerCount('move'), 0);
assert.equal(contents.listenerCount('did-finish-load'), 0);
console.log('Window DPI regression checks passed');
