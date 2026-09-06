'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWindowShortcuts, pushToTalkAccelerator } = require('../window-shortcuts');

assert.equal(pushToTalkAccelerator({ ctrl: true, shift: true, key: 'm' }), 'CommandOrControl+Shift+M');
assert.equal(pushToTalkAccelerator({ alt: true, key: '+' }), 'Alt+Plus');
assert.equal(pushToTalkAccelerator({ key: ' ' }), 'Space');
assert.equal(pushToTalkAccelerator({ key: 'pagedown' }), 'PageDown');
assert.equal(pushToTalkAccelerator({ key: 'f12' }), 'F12');
assert.equal(pushToTalkAccelerator({ ctrl: true }), null);
assert.equal(pushToTalkAccelerator({ key: 10 }), null);
assert.equal(pushToTalkAccelerator(false), null);

const registered = new Map();
const released = [];
let blocked = false;
const registry = createWindowShortcuts({
  register(key, callback) {
    if (key === 'Invalid') throw new Error('invalid accelerator');
    if (blocked) return false;
    assert.ok(!registered.has(key), 'shared keys register only once');
    registered.set(key, callback);
    return true;
  },
  unregister(key) { released.push(key); registered.delete(key); },
}, 'win32');
const window = () => Object.assign(new EventEmitter(), {
  destroyed: false, isDestroyed() { return this.destroyed; },
  close() { this.destroyed = true; this.emit('closed'); },
});
const a = window(), b = window();
const fired = [];
registry.set(a, 'mute', 'CommandOrControl+M', () => fired.push('a'));
registry.set(b, 'mute', 'CommandOrControl+M', () => fired.push('b'));
registered.get('CommandOrControl+M')();
assert.deepEqual(fired, ['b']);
b.close();
registered.get('CommandOrControl+M')();
assert.deepEqual(fired, ['b', 'a']);
assert.equal(released.length, 0, 'closing an owner preserves other bindings');
const c = window();
registry.set(c, 'ppt', 'Ctrl+M', () => fired.push('ppt'));
registered.get('CommandOrControl+M')();
assert.equal(fired.at(-1), 'ppt', 'equivalent accelerators share ownership');
registry.remove(c, 'ppt');
registered.get('CommandOrControl+M')();
assert.equal(fired.at(-1), 'a', 'removing PPT must not unregister mute');
registry.set(a, 'fullscreen', 'Alt+Enter', () => fired.push('a-full'));
registry.set(c, 'fullscreen', 'Alt+Enter', () => fired.push('c-full'));
registry.remove(a, 'fullscreen');
registered.get('Alt+Enter')();
assert.equal(fired.at(-1), 'c-full', 'a late blur cannot remove another window fullscreen key');
registry.remove(c, 'fullscreen');
assert.ok(!registered.has('Alt+Enter'));
blocked = true;
assert.equal(registry.set(c, 'ppt', 'Alt+P', () => {}), false);
registry.remove(c, 'ppt');
assert.ok(!released.includes('Alt+P'), 'never unregister a shortcut we could not acquire');
assert.equal(registry.set(c, 'ppt', 'Alt+P', () => {}), false);
blocked = false;
assert.equal(registry.set(c, 'ppt', 'Alt+P', () => {}), true, 'retry after an OS conflict clears');
assert.equal(registry.set(c, 'ppt', 'Invalid', () => {}), false);
c.close();
a.close();
assert.equal(registered.size, 0);
assert.equal(registry.set(a, 'mute', 'Ctrl+M', () => {}), false);
console.log('Window shortcut ownership regression checks passed');
