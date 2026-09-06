'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { showCustomCodePrompt } = require('../custom-code-prompt');
const { showWindowPrompt } = require('../window-prompt');

async function testWindowPrompt() {
  let destroyed = false;
  const pin = [], values = [];
  const window = { isDestroyed: () => destroyed, isAlwaysOnTop: () => true,
    setAlwaysOnTop: value => pin.push(value) };
  const options = () => ({ title: 'Edit', value: 'old' });
  await showWindowPrompt(window, async () => null, options, value => values.push(value));
  assert.deepEqual(pin, [false, true]);
  assert.equal(values.length, 0);
  await showWindowPrompt(window, async () => '', options, value => values.push(value));
  assert.deepEqual(values, [''], 'empty titles are valid submitted values');
  await showWindowPrompt(window, async () => { throw new Error('prompt failed'); }, options, () => {});
  assert.equal(pin.at(-1), true);
  await showWindowPrompt(window, async () => 'new', options, async () => { throw new Error('edit failed'); });
  assert.equal(pin.at(-1), true, 'failed edits still restore the original pin setting');
  await showWindowPrompt(window, async () => { destroyed = true; return 'late'; }, options, value => values.push(value));
  assert.deepEqual(values, [''], 'late replies do not update a destroyed window');
  const pinCount = pin.length;
  await showWindowPrompt(window, async () => 'late', options, () => {});
  assert.equal(pin.length, pinCount, 'closed windows do not open new prompts');
}

async function testOverlappingPrompts() {
  for (const firstToClose of ['edit', 'code']) {
    let pinned = true;
    const changes = [];
    const window = {
      isDestroyed: () => false, isAlwaysOnTop: () => pinned,
      setAlwaysOnTop(value) { pinned = value; changes.push(value); },
      webContents: { isDestroyed: () => false, executeJavaScript: async () => null },
    };
    let finishEdit, finishCode;
    const edit = showWindowPrompt(window, () => new Promise(resolve => { finishEdit = resolve; }), () => ({}), () => {});
    const code = showCustomCodePrompt(window, () => new Promise(resolve => { finishCode = resolve; }), 'js');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(changes, [false]);
    if (firstToClose === 'edit') { finishEdit(null); await edit; }
    else { finishCode(null); await code; }
    assert.equal(pinned, false, 'window stays unpinned while another dialog is open');
    if (firstToClose === 'edit') { finishCode(null); await code; }
    else { finishEdit(null); await edit; }
    assert.deepEqual(changes, [false, true], 'last dialog restores the original pin once');
    pinned = false;
    changes.length = 0;
    await showWindowPrompt(window, async () => null, () => ({}), () => {});
    assert.deepEqual(changes, [], 'an originally unpinned window stays unpinned');
  }
}

function testShutdown() {
  const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const timers = [];
  let cleanupCount = 0, hangups = 0, quits = 0;
  const app = new EventEmitter();
  app.quit = () => quits++;
  const goodWindow = {
    isDestroyed: () => false, hide() {},
    webContents: { isDestroyed: () => false, send() { hangups++; } },
  };
  const badWindow = { ...goodWindow, hide() { throw new Error('window gone'); } };
  const context = {
    app, global: {}, console: { warn() {}, error() {} },
    BrowserWindow: { getAllWindows: () => [badWindow, goodWindow] },
    asioIpcHandlers: { cleanupAsio: () => cleanupCount++ },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); },
  };
  const start = source.indexOf("app.on('before-quit', (event) => {");
  const end = source.indexOf('const folder = earlyDataPaths', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  app.emit('before-quit', event);
  app.emit('before-quit', event);
  assert.equal(prevented, 2);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1600, 'preserve the existing recording grace period');
  assert.equal(cleanupCount, 1);
  assert.equal(hangups, 1, 'one broken window cannot block shutdown notifications');
  timers[0].callback();
  assert.equal(quits, 1);
  app.emit('before-quit', event);
  assert.equal(prevented, 2, 'the final quit must proceed');
  const window = new EventEmitter();
  const closeStart = source.indexOf("\tmainWindow.on('close', function(e) {");
  const closeEnd = source.indexOf("\tmainWindow.on('closed'", closeStart);
  assert.ok(closeStart >= 0 && closeEnd > closeStart);
  vm.runInNewContext(source.slice(closeStart, closeEnd), { ...context, mainWindow: window });
  window.emit('close', event);
  assert.equal(prevented, 2, 'the window must not veto the final app quit');
}

async function testCustomCode() {
  const storage = new Map();
  const applied = [];
  let denyStorage = false, destroyed = false;
  const pin = [];
  const contents = {
    isDestroyed: () => destroyed,
    async executeJavaScript(source) {
      if (source.startsWith('localStorage.')) {
        if (denyStorage) throw new Error('storage unavailable');
        return vm.runInNewContext(source, { localStorage: {
          getItem: key => storage.get(key) ?? null,
          setItem: (key, value) => storage.set(key, value),
        } });
      }
      applied.push(source);
    },
    async insertCSS(source) { applied.push(source); },
  };
  const window = { isDestroyed: () => destroyed, isAlwaysOnTop: () => true,
    setAlwaysOnTop: value => pin.push(value), webContents: contents };
  const css = "body::after { content: 'hello'; }\n/* `quoted` \\ path */";
  await showCustomCodePrompt(window, async () => css, 'css');
  assert.equal(storage.get('insertCSS'), css);
  assert.equal(applied.at(-1), css);
  assert.deepEqual(pin, [false, true]);
  denyStorage = true;
  await showCustomCodePrompt(window, async () => css, 'css');
  assert.equal(applied.length, 2, 'unavailable storage must not disable custom CSS');
  await showCustomCodePrompt(window, async () => { throw new Error('prompt failed'); }, 'js');
  assert.equal(pin.at(-1), true, 'prompt failure restores always-on-top');
  await showCustomCodePrompt(window, async () => null, 'js');
  assert.equal(applied.length, 2);
  denyStorage = false;
  const js = "console.log('arbitrary custom code still runs');";
  await showCustomCodePrompt(window, async () => js, 'js');
  assert.equal(storage.get('insertJS'), js);
  assert.equal(applied.at(-1), js);
  await showCustomCodePrompt(window, async () => { destroyed = true; return css; }, 'css');
  assert.equal(applied.length, 3, 'a closed window must not receive late injections');
}

testShutdown();
testCustomCode().then(testWindowPrompt).then(testOverlappingPrompts).then(() => console.log('Shutdown and editing dialog regression checks passed'))
  .catch(error => { console.error(error); process.exitCode = 1; });
