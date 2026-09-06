'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createBoundsStore, installBoundsPersistence } = require('../window-bounds');

async function main() {
  const good = { x: -1920, y: 0, width: 1280, height: 720 };
  const files = new Map([['bounds', JSON.stringify(good)]]);
  let failWrite = false, failRename = false;
  const store = createBoundsStore('bounds', {
    readFileSync: file => files.get(file),
    writeFileSync(file, value) {
      files.set(file, failWrite ? '{' : value);
      if (failWrite) throw new Error('disk full');
    },
    renameSync(from, to) {
      if (failRename) throw new Error('file locked');
      files.set(to, files.get(from)); files.delete(from);
    },
    unlinkSync: file => files.delete(file),
  });
  assert.deepEqual(store.load(), good, 'negative monitor positions are valid');
  failWrite = true;
  assert.equal(store.save({ ...good, x: 20 }), false);
  assert.deepEqual(store.load(), good, 'partial writes must preserve previous settings');
  failWrite = false; failRename = true;
  assert.equal(store.save({ ...good, x: 20 }), false);
  assert.deepEqual(store.load(), good);
  assert.equal(files.size, 1, 'temporary files are cleaned up after failure');
  failRename = false;
  assert.equal(store.save({ ...good, x: 20 }), true);
  assert.equal(store.load().x, 20);
  for (const value of [{ width: 200, height: 100 }, { ...good, x: null },
    { ...good, width: -1 }, { ...good, x: 0.5 }, { ...good, height: 1e30 }]) {
    assert.equal(store.save(value), false);
    files.set('bounds', JSON.stringify(value));
    assert.equal(store.load(), null);
  }

  const saved = [];
  let bounds = good;
  const window = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isMinimized: () => false,
    isMaximized: () => false, isFullScreen: () => false, getBounds: () => bounds,
  });
  installBoundsPersistence(window, value => saved.push(value), 10);
  window.emit('move');
  bounds = { ...good, x: 100 };
  window.emit('resize');
  window.emit('close');
  assert.deepEqual(saved, [bounds], 'close immediately flushes the latest pending bounds');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(saved.length, 1);
  window.emit('move');
  window.emit('closed');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(saved.length, 1, 'destroyed windows retain no pending save');
  assert.equal(window.listenerCount('resize'), 0);
  console.log('Window bounds regression checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
