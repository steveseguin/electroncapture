'use strict';
const { suspendWindowPin } = require('./window-prompt');

async function showCustomCodePrompt(window, prompt, kind) {
  if (window.isDestroyed()) return;
  const contents = window.webContents;
  const css = kind === 'css';
  const storageKey = css ? 'insertCSS' : 'insertJS';
  let restorePin;
  try {
    restorePin = suspendWindowPin(window);
    let savedValue;
    try {
      savedValue = await contents.executeJavaScript(`localStorage.getItem(${JSON.stringify(storageKey)});`);
    } catch (error) {
      console.warn('Unable to read saved custom code:', error.message);
    }
    if (window.isDestroyed() || contents.isDestroyed()) return;
    const result = await prompt({
      title: css ? 'Insert Custom CSS' : 'Insert Custom JavaScript',
      label: css ? 'CSS:' : 'JavaScript:',
      value: savedValue ?? (css ? 'body {background-color:#0000;}' : "console.log('Custom JavaScript loaded');"),
      inputAttrs: { type: 'text' }, resizable: true, type: 'input', alwaysOnTop: true,
    });
    if (result === null || result === undefined || window.isDestroyed() || contents.isDestroyed()) return;
    try {
      await contents.executeJavaScript(`localStorage.setItem(${JSON.stringify(storageKey)}, ${JSON.stringify(result)});`);
    } catch (error) {
      console.warn('Unable to save custom code:', error.message);
    }
    if (window.isDestroyed() || contents.isDestroyed()) return;
    if (css) await contents.insertCSS(result, { cssOrigin: 'user' });
    else await contents.executeJavaScript(result);
  } catch (error) {
    console.error('Custom code prompt failed:', error);
  } finally {
    restorePin?.();
  }
}

module.exports = { showCustomCodePrompt };
