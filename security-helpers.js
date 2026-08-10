'use strict';

const HTML_ESCAPES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

function escapeHtmlWithLineBreaks(value) {
  return String(value ?? '')
    .replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
    .replace(/\r?\n/g, '<br /><br />');
}

function isUrlWithinDomain(value, expectedDomain) {
  try {
    const hostname = new globalThis.URL(value).hostname.toLowerCase().replace(/\.$/, '');
    const domain = String(expectedDomain).toLowerCase().replace(/^\.+|\.+$/g, '');
    return domain.length > 0 && (hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

module.exports = {
  escapeHtmlWithLineBreaks,
  isUrlWithinDomain,
};
