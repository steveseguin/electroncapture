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

console.log('Security regression checks passed');
