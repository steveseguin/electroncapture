'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { formatURL, iframeNavigationScript } = require('../navigation-helpers');

for (const input of ['about:blank', 'data:text/html,<b>capture</b>', 'data:123',
  'file:///C:/video.html', 'HTTP://localhost:8000/', 'chrome://gpu', 'custom://capture']) {
  assert.equal(formatURL(input), input);
}
assert.equal(formatURL('  https://vdo.ninja/  '), 'https://vdo.ninja/');
assert.equal(formatURL('localhost:8000/video'), 'https://localhost:8000/video');
assert.equal(formatURL('example.com:8000'), 'https://example.com:8000');
assert.equal(formatURL('//vdo.ninja/'), 'https://vdo.ninja/');
assert.equal(formatURL('vdo.ninja/'), 'https://vdo.ninja/');
const previous = 'https://example.test/?title="old"';
const next = 'data:text/html,<p title="new">\nquoted \\ content</p>';
const frame = { tagName: 'IFRAME', src: previous };
const document = { elementFromPoint: () => null, querySelectorAll: () => [frame] };
vm.runInNewContext(iframeNavigationScript(10, 20, previous, next), { document });
assert.equal(frame.src, next, 'missing hit-test target falls back to a matching frame and preserves URL text');
document.elementFromPoint = () => frame;
vm.runInNewContext(iframeNavigationScript(10, 20, previous, 'about:blank'), { document });
assert.equal(frame.src, 'about:blank');
document.elementFromPoint = () => null;
document.querySelectorAll = () => [];
assert.doesNotThrow(() => vm.runInNewContext(iframeNavigationScript(10, 20, previous, next), { document }));
console.log('Navigation helper regression checks passed');
