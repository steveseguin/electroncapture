'use strict';

async function runPageOperation(target, method, ...args) {
  try {
    if (!target || (typeof target.isDestroyed === 'function' && target.isDestroyed())) return;
    return await target[method](...args);
  } catch (error) {
    // A newer navigation intentionally supersedes the initial placeholder page.
    if (method === 'loadURL' && (error.code === 'ERR_ABORTED' || error.errno === -3)) return;
    console.warn(`Page operation ${method} failed:`, error.message || error);
  }
}

const cursorStates = new WeakMap();
const hiddenCursorCSS = `
  * { cursor: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=), none !important; user-select: none !important; }
  :root { --electron-drag-fix: none !important; }
`;

function setCursorHidden(contents, hidden) {
  let state = cursorStates.get(contents);
  if (!state) {
    state = { key: null, pending: Promise.resolve() };
    cursorStates.set(contents, state);
  }
  // Serialize insert/remove: an asynchronous insertion must not finish after
  // the user turns the option off and leave the cursor hidden again.
  state.pending = state.pending.then(async () => {
    if (state.key) {
      await runPageOperation(contents, 'removeInsertedCSS', state.key);
      state.key = null;
    }
    if (hidden) state.key = await runPageOperation(contents, 'insertCSS', hiddenCursorCSS);
  });
  return state.pending;
}

module.exports = { runPageOperation, setCursorHidden };
