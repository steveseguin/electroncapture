'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  escapeHtmlWithLineBreaks,
  isUrlWithinDomain,
} = require('../security-helpers');

assert.strictEqual(isUrlWithinDomain('https://youtube.com/watch?v=1', 'youtube.com'), true);
assert.strictEqual(isUrlWithinDomain('https://www.youtube.com/watch?v=1', 'youtube.com'), true);
assert.strictEqual(isUrlWithinDomain('https://youtube.com.evil.test/', 'youtube.com'), false);
assert.strictEqual(isUrlWithinDomain('https://evil.test/youtube.com', 'youtube.com'), false);
assert.strictEqual(isUrlWithinDomain('https://youtube.com@evil.test/', 'youtube.com'), false);
assert.strictEqual(isUrlWithinDomain('not a URL', 'youtube.com'), false);

assert.strictEqual(
  escapeHtmlWithLineBreaks('<img src=x onerror="run()">\n&second\nthird'),
  '&lt;img src=x onerror=&quot;run()&quot;&gt;<br /><br />&amp;second<br /><br />third',
);

const mainSource = fs.readFileSync(path.resolve('main.js'), 'utf8');
assert.doesNotMatch(mainSource, /rejectUnauthorized\s*:\s*false/);
assert.doesNotMatch(mainSource, /appendSwitch\(['"]ignore-certificate-errors/);
assert.doesNotMatch(mainSource, /getURL\(\)\.includes\(['"]youtube\.com/);

// Exercise the retained legacy navigation handler directly: hostile URL text
// must remain a string even if a platform/plugin still emits this event.
const vm = require('vm');
const start = mainSource.indexOf("mainWindow.webContents.on('new-window'");
const end = mainSource.indexOf('installDownloadHandler(mainWindow', start);
assert.ok(start >= 0 && end > start);
for (const nested of [false, true]) {
  const target = { url: 'https://fixture.invalid/' };
  const frames = nested ? [{ url: 'https://parent.invalid/', frames: [target] }] : [target];
  let handler;
  let prevented = false;
  const renderer = { window: {}, injected: false };
  vm.runInNewContext(mainSource.slice(start, end), {
    mainWindow: { webContents: { mainFrame: { frames }, on: (_name, callback) => { handler = callback; } } },
    console: { log() {} },
    runPageOperation(frame, method, code) {
      assert.strictEqual(frame, target);
      assert.strictEqual(method, 'executeJavaScript');
      vm.runInNewContext(code, renderer);
    },
  });
  const url = 'https://fixture.invalid/"; globalThis.injected = true; //';
  handler({ preventDefault() { prevented = true; } }, url, null, null, null, null, { url: target.url });
  assert.strictEqual(prevented, true);
  assert.strictEqual(renderer.window.location, url);
  assert.strictEqual(renderer.injected, false);
}

console.log('Security regression checks passed');
