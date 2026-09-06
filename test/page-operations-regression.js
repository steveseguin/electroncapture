'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { runPageOperation, setCursorHidden } = require('../page-operations');

async function main() {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(await runPageOperation({ executeJavaScript: async () => 42 }, 'executeJavaScript', 'arbitrary code'), 42);
    await runPageOperation({ loadURL: async () => { throw Object.assign(new Error('cancelled'), { code: 'ERR_ABORTED' }); } }, 'loadURL', 'data:text/html,ok');
    assert.equal(warnings.length, 0);
    await runPageOperation({ loadURL: async () => { throw new Error('DNS failure'); } }, 'loadURL', 'https://example.test');
    await runPageOperation({ executeJavaScript() { throw new Error('frame gone'); } }, 'executeJavaScript', 'code');
    assert.equal(warnings.length, 2, 'both sync and async failures are reported');
    let invoked = false;
    await runPageOperation({ isDestroyed: () => true, loadURL() { invoked = true; } }, 'loadURL', 'url');
    assert.equal(invoked, false);

    const source = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    const menuStart = source.indexOf('Enable Chrome Extension');
    const clickStart = source.indexOf('click: () => {', menuStart) + 'click: '.length;
    const clickEnd = source.indexOf('\n\t\t},', clickStart);
    assert.ok(menuStart >= 0 && clickEnd > clickStart);
    let selection = 0, destroyed = false, attempts = 0;
    const click = vm.runInNewContext(`(${source.slice(clickStart, clickEnd)})`, {
      extensions: [{ name: 'Example', location: '/extension' }],
      dialog: { showMessageBoxSync: () => selection },
      browserWindow: {
        isDestroyed: () => destroyed,
        get webContents() {
          assert.equal(destroyed, false, 'closed windows must not be dereferenced');
          return { isDestroyed: () => false, session: {
            async loadExtension(location) {
              assert.equal(location, '/extension');
              attempts++;
              throw new Error('incompatible extension');
            },
          } };
        },
      },
      runPageOperation,
    });
    for (selection of [0, -1, 2]) click();
    assert.equal(attempts, 0, 'cancelled or invalid selections do not load extensions');
    selection = 1;
    destroyed = true;
    click();
    assert.equal(attempts, 0);
    destroyed = false;
    click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(attempts, 1);
    assert.equal(warnings.length, 3, 'extension rejection is handled and reported');
  } finally { console.warn = warn; }

  const styles = new Map([['website-style', 'cursor: crosshair; user-select: text']]);
  let resolveInsert;
  let counter = 0;
  let delayed = true;
  const contents = {
    isDestroyed: () => false,
    async insertCSS(css) {
      if (delayed) await new Promise(resolve => { resolveInsert = resolve; });
      const key = `style-${++counter}`;
      styles.set(key, css);
      return key;
    },
    async removeInsertedCSS(key) { styles.delete(key); },
  };
  const hide = setCursorHidden(contents, true);
  const show = setCursorHidden(contents, false);
  await new Promise(resolve => setImmediate(resolve));
  resolveInsert();
  await Promise.all([hide, show]);
  assert.deepEqual([...styles.keys()], ['website-style'], 'late insertion must not defeat show-cursor');
  delayed = false;
  await setCursorHidden(contents, true);
  await setCursorHidden(contents, true);
  assert.equal(styles.size, 2, 'repeated hide replaces rather than accumulating styles');
  await setCursorHidden(contents, false);
  assert.deepEqual([...styles.keys()], ['website-style']);
  console.log('Page operation and cursor regression checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
