'use strict';

function formatURL(value) {
  const input = String(value).trim();
  if (input.startsWith('//')) return `https:${input}`;
  if (/^(data|about|blob|file|javascript|chrome|chrome-extension|devtools):/i.test(input)) return input;
  // A bare host:port is not a URL scheme, even for a single-label host.
  const hostWithPort = /^[^/?#]+:\d+(?:[/?#]|$)/.test(input);
  if (!hostWithPort && /^[a-z][a-z0-9+.-]*:/i.test(input)) return input;
  return `https://${input}`;
}

function iframeNavigationScript(x, y, previousURL, nextURL) {
  return `(${function (x, y, previousURL, nextURL) {
    let element = document.elementFromPoint(x, y);
    if (!element || element.tagName !== 'IFRAME') {
      element = [...document.querySelectorAll('iframe')].find(frame => frame.src === previousURL);
    }
    if (element) element.src = nextURL;
  }.toString()})(${JSON.stringify(x)}, ${JSON.stringify(y)}, ${JSON.stringify(previousURL)}, ${JSON.stringify(nextURL)});`;
}

module.exports = { formatURL, iframeNavigationScript };
