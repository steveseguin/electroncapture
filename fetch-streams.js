'use strict';

const { randomUUID } = require('crypto');

// Keep requests tied to the page that started them, including requests still
// waiting for headers. Reloading a live feed must release its old connection.
function setupFetchStreams(ipcMain, fetch) {
  const streams = new Map();
  const owners = new Map();

  function release(id, cancel = false) {
    const entry = streams.get(id);
    if (!entry) return;
    streams.delete(id);
    const owner = owners.get(entry.sender);
    owner.ids.delete(id);
    if (!owner.ids.size) {
      for (const [event, listener] of owner.listeners) entry.sender.removeListener(event, listener);
      owners.delete(entry.sender);
    }
    if (cancel) {
      entry.controller.abort();
      if (entry.reader) Promise.resolve(entry.reader.cancel()).catch(() => {});
    }
  }

  ipcMain.handle('noCORSFetch', async (event, args) => {
    const sender = event.sender;
    if (sender.isDestroyed()) return { ok: false, error: 'Window closed' };
    const id = randomUUID();
    let owner = owners.get(sender);
    if (!owner) {
      const cleanup = () => { for (const id of [...owner.ids]) release(id, true); };
      owner = { ids: new Set(), listeners: [
        ['destroyed', cleanup],
        ['render-process-gone', cleanup],
        ['did-start-navigation', (_event, _url, inPlace, mainFrame) => {
          if (mainFrame && !inPlace) cleanup();
        }],
      ] };
      owners.set(sender, owner);
      for (const [name, listener] of owner.listeners) sender.on(name, listener);
    }
    const entry = { sender, controller: new AbortController(), reader: null };
    owner.ids.add(id);
    streams.set(id, entry);
    try {
      const response = await fetch(args.url, {
        method: args.method || 'GET', headers: { ...args.headers }, signal: entry.controller.signal,
      });
      if (!streams.has(id)) {
        if (response.body) await response.body.cancel();
        return { ok: false, error: 'Page closed or navigated' };
      }
      if (!response.ok) {
        if (response.body) await response.body.cancel();
        release(id);
        return { ok: false, status: response.status, statusText: response.statusText };
      }
      const contentType = response.headers.get('content-type') || '';
      const match = contentType.match(/boundary\s*=\s*(?:"([^"]*)"|([^;\s]+))/i);
      entry.reader = response.body ? response.body.getReader() : null;
      if (!entry.reader) release(id);
      return { ok: true, status: response.status, streamId: id, contentType, boundary: match ? match[1] ?? match[2] : null };
    } catch (error) {
      release(id, true);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle('readStreamChunk', async (_event, id) => {
    const entry = streams.get(id);
    if (!entry) return { done: true };
    try {
      const { done, value } = await entry.reader.read();
      if (done) { release(id); return { done: true }; }
      return { done: false, value: Array.from(value) };
    } catch (error) {
      release(id, true);
      throw error;
    }
  });
  ipcMain.handle('closeStream', async (_event, id) => {
    release(id, true);
    return true;
  });
}

module.exports = { setupFetchStreams };
