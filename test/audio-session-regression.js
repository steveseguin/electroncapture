'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createWindowAudioSession } = require('../window-audio-session');

const sender = id => Object.assign(new EventEmitter(), { id, isDestroyed: () => false, send() {} });
const tick = () => new Promise(resolve => setImmediate(resolve));

async function testWindowAudio() {
  const calls = [];
  const callbacks = [];
  let resolveStart;
  let delayed = false;
  let failStop = false;
  const backend = {
    startStreamCapture(target, callback) {
      calls.push(`start:${target}`);
      callbacks.push(callback);
      if (delayed) return new Promise(resolve => { resolveStart = resolve; });
      return { success: true, sampleRate: 44100, channels: 2 };
    },
    stopStreamCapture() {
      calls.push('stop');
      if (failStop) throw new Error('device busy');
      return { success: true };
    },
  };
  const forwarded = [];
  const sessions = createWindowAudioSession(() => backend, (...args) => forwarded.push(args));
  const a = sender(1), b = sender(2);
  const start = (owner, id) => sessions.start(owner, { requestTarget: id, clientId: String(id) });
  delayed = true;
  const first = start(a, 10);
  await tick();
  const second = start(b, 20);
  await tick();
  assert.deepEqual(calls, ['start:10'], 'native starts must not overlap');
  delayed = false;
  resolveStart({ success: true });
  assert.equal((await first).success, true);
  assert.equal((await second).success, true);
  assert.deepEqual(calls, ['start:10', 'stop', 'start:20']);
  callbacks[0]('stale packet');
  callbacks[1]('current packet');
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0][1], '20');
  await sessions.stop(a.id);
  assert.equal(calls.length, 3, 'old owner cannot stop the new owner');
  b.emit('did-start-navigation', {}, 'url', true, true);
  b.emit('did-start-navigation', {}, 'url', false, false);
  await tick();
  assert.equal(calls.length, 3);
  b.emit('did-start-navigation', {}, 'url', false, true);
  await tick();
  assert.equal(calls.at(-1), 'stop');
  assert.equal(b.listenerCount('destroyed'), 0);

  delayed = true;
  const closing = start(a, 30);
  await tick();
  a.emit('destroyed');
  const next = start(b, 40);
  delayed = false;
  resolveStart({ success: true });
  assert.equal((await closing).success, false);
  assert.equal((await next).success, true);
  await tick();
  assert.equal(calls.at(-1), 'start:40', 'late cleanup cannot stop a newer session');
  assert.equal(a.listenerCount('destroyed'), 0);
  failStop = true;
  assert.equal((await start(a, 50)).success, false);
  assert.ok(!calls.includes('start:50'), 'a failed stop must prevent overlapping native capture');
  assert.equal(a.listenerCount('destroyed'), 0);
  failStop = false;
  await sessions.stop();
  assert.equal((await start(a, 60)).success, true, 'queue recovers after a backend failure');
  a.emit('render-process-gone');
  await tick();
  assert.equal(a.listenerCount('did-start-navigation'), 0);
  assert.equal(calls.at(-1), 'stop');
}

function testAsio() {
  const created = [];
  let failSetup = false;
  const asio = {
    terminate() {},
    createStream() {
      const stream = Object.assign(new EventEmitter(), {
        closeCount: 0,
        close() { this.closeCount++; },
        setProcessCallback(callback) {
          if (failSetup) throw new Error('callback setup failed');
          this.callback = callback;
        },
        start() { return true; },
      });
      created.push(stream);
      return stream;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../native-modules/electron-asio/preload/ipc-handlers.js'), 'utf8'), {
    module, require: () => asio, console,
  });
  const handlers = {};
  module.exports.setupAsioIpc({ handle: (name, handler) => { handlers[name] = handler; } });
  const a = sender(1), b = sender(2);
  let sends = 0;
  a.send = () => sends++;
  const create = owner => handlers['asio:createStream']({ sender: owner }, {});
  const first = create(a), second = create(a), other = create(b);
  assert.equal(a.listenerCount('destroyed'), 1, 'one set of listeners per renderer');
  a.emit('did-start-navigation', {}, 'url', true, true);
  assert.equal(created[0].closeCount, 0);
  a.emit('did-start-navigation', {}, 'url', false, true);
  assert.equal(created[0].closeCount, 1);
  assert.equal(created[1].closeCount, 1);
  assert.equal(created[2].closeCount, 0);
  created[0].callback([new Float32Array([1])], []);
  assert.equal(sends, 0, 'late callbacks must not send to the replacement page');
  assert.throws(() => handlers['asio:startStream']({}, first.streamId), /Stream not found/);
  handlers['asio:closeStream']({}, second.streamId);
  assert.equal(created[1].closeCount, 1, 'close is idempotent');
  assert.equal(a.listenerCount('destroyed'), 0);
  b.emit('destroyed');
  assert.equal(created[2].closeCount, 1);
  failSetup = true;
  assert.throws(() => create(a), /callback setup failed/);
  assert.equal(created[3].closeCount, 1);
  assert.equal(a.listenerCount('destroyed'), 0);
  failSetup = false;
  create(a);
  a.emit('render-process-gone');
  assert.equal(created[4].closeCount, 1);
  create(a);
  module.exports.cleanupAsio();
  assert.equal(created[5].closeCount, 1);
  assert.equal(a.listenerCount('destroyed'), 0);
}

testWindowAudio().then(() => {
  testAsio();
  console.log('Native audio session lifecycle regression checks passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
