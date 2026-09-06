'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { setupFetchStreams } = require('../fetch-streams');
const { onWindowIpc, installDownloadHandler } = require('../window-lifecycle');

function sender() {
  return Object.assign(new EventEmitter(), { isDestroyed: () => false });
}

async function main() {
  const handlers = {};
  const ipc = new EventEmitter();
  ipc.handle = (name, handler) => { handlers[name] = handler; };
  const session = new EventEmitter();
  const makeWindow = (folder) => Object.assign(new EventEmitter(), {
    isDestroyed: () => false, args: { savefolder: folder },
    webContents: Object.assign(sender(), { session, getURL: () => 'https://example.test/' }),
  });
  const a = makeWindow('first');
  const b = makeWindow('second');
  const app = { getPath: () => 'downloads' };
  for (const window of [a, b]) installDownloadHandler(window, window.args, app);
  const paths = [];
  const item = { getFilename: () => 'recording.webm', setSavePath: p => paths.push(p) };
  session.emit('will-download', {}, item, a.webContents);
  assert.deepEqual(paths, [path.join('first', 'recording.webm')]);
  a.args = { savefolder: 'updated' };
  session.emit('will-download', {}, item, a.webContents);
  assert.equal(paths.at(-1), path.join('updated', 'recording.webm'));
  let replies = 0;
  onWindowIpc(ipc, a, 'version', () => replies++);
  ipc.emit('version', { sender: b.webContents });
  assert.equal(replies, 0);
  ipc.emit('version', { sender: a.webContents });
  assert.equal(replies, 1);
  a.emit('closed');
  assert.equal(ipc.listenerCount('version'), 0);
  assert.equal(session.listenerCount('will-download'), 1);
  b.emit('closed');
  assert.equal(session.listenerCount('will-download'), 0);

  for (const platform of ['win32', 'darwin', 'linux']) {
    const window = makeWindow(null);
    installDownloadHandler(window, window.args, { getPath: name => name }, platform);
    const previousCount = paths.length;
    session.emit('will-download', {}, item, window.webContents);
    assert.equal(paths.length, previousCount, 'ordinary downloads retain their save dialog');
    window.webContents.getURL = () => 'https://example.test/?autorecord';
    session.emit('will-download', {}, item, window.webContents);
    assert.equal(paths.at(-1), path.join(platform === 'linux' ? 'home' : 'downloads', 'recording.webm'));
    const warnings = [];
    const oldWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
      assert.doesNotThrow(() => session.emit('will-download', {}, {
        getFilename: item.getFilename,
        setSavePath: () => { throw new Error('download no longer available'); },
      }, window.webContents));
      window.args = { savefolder: 42 };
      assert.doesNotThrow(() => session.emit('will-download', {}, item, window.webContents));
      assert.equal(warnings.length, 2, 'save path failures must be reported without escaping the event');
    } finally { console.warn = oldWarn; }
    window.emit('closed');
    assert.equal(session.listenerCount('will-download'), 0);
  }

  let cancelled = 0;
  let status = 200;
  let pendingResolve;
  let lastSignal;
  setupFetchStreams(ipc, async (url, options) => {
    lastSignal = options.signal;
    if (url === 'pending') return new Promise(resolve => { pendingResolve = resolve; });
    return new Response(status === 204 ? null : new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
      cancel() { cancelled++; },
    }), { status, headers: { 'content-type': 'multipart/mixed; boundary="frame"' } });
  });
  const page = sender();
  const event = { sender: page };
  const fetch = url => handlers.noCORSFetch(event, { url });
  const oldNow = Date.now;
  Date.now = () => 123;
  let first, second;
  try { [first, second] = await Promise.all([fetch('a'), fetch('b')]); }
  finally { Date.now = oldNow; }
  assert.notEqual(first.streamId, second.streamId, 'simultaneous fetches must stay independent');
  assert.equal(first.boundary, 'frame');
  assert.deepEqual(await handlers.readStreamChunk(event, first.streamId), { done: false, value: [1, 2, 3] });
  page.emit('did-start-navigation', {}, 'url', true, true);
  assert.equal(cancelled, 0, 'in-page navigation keeps the feed');
  page.emit('did-start-navigation', {}, 'url', false, false);
  assert.equal(cancelled, 0, 'subframe navigation keeps the feed');
  page.emit('did-start-navigation', {}, 'url', false, true);
  await Promise.resolve();
  assert.equal(cancelled, 2);
  assert.equal(page.listenerCount('destroyed'), 0);
  assert.deepEqual(await handlers.readStreamChunk(event, second.streamId), { done: true });
  status = 204;
  const empty = await fetch('empty');
  assert.equal(empty.ok, true);
  assert.deepEqual(await handlers.readStreamChunk(event, empty.streamId), { done: true });
  status = 500;
  assert.equal((await fetch('error')).status, 500);
  assert.equal(cancelled, 3, 'HTTP error bodies must be released');
  const pending = fetch('pending');
  page.emit('destroyed');
  assert.equal(lastSignal.aborted, true);
  pendingResolve(new Response('late response'));
  assert.equal((await pending).ok, false);
  assert.equal(page.listenerCount('did-start-navigation'), 0);
  status = 200;
  const explicit = await fetch('explicit-close');
  assert.equal(await handlers.closeStream(event, explicit.streamId), true);
  assert.deepEqual(await handlers.readStreamChunk(event, explicit.streamId), { done: true });
  assert.equal(page.listenerCount('destroyed'), 0);
  const crashed = await fetch('crash');
  page.emit('render-process-gone', {}, { reason: 'crashed' });
  assert.deepEqual(await handlers.readStreamChunk(event, crashed.streamId), { done: true });
  assert.equal(page.listenerCount('render-process-gone'), 0);
  console.log('Window and fetch lifecycle regression checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
