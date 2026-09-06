'use strict';

const path = require('path');
const { randomUUID } = require('crypto');

function requestDeviceList(ipcMain, window, params, callback, timeoutMs = 15000) {
  if (window.isDestroyed()) return;
  const sender = window.webContents;
  const requestId = randomUUID();
  let released = false;
  const releaseTarget = () => {
    if (released) return;
    released = true;
    if (!sender.isDestroyed()) {
      try { sender.send('postMessage', { releaseDeviceList: requestId }); }
      catch (error) { console.warn('Unable to release device menu target:', error); }
    }
  };
  const detach = () => {
    clearTimeout(timer);
    ipcMain.removeListener('deviceList', onReply);
    sender.removeListener('destroyed', cleanup);
    sender.removeListener('render-process-gone', cleanup);
    sender.removeListener('did-start-navigation', onNavigation);
  };
  const cleanup = () => { detach(); releaseTarget(); };
  const onNavigation = (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) cleanup();
  };
  const onReply = (event, data) => {
    if (event.sender !== sender || !data || data.requestId !== requestId) return;
    detach();
    try {
      if (window.isDestroyed() || sender.isDestroyed()) return;
      if (data.error || !Array.isArray(data.deviceInfos)) {
        console.warn('Unable to enumerate media devices:', data.error || 'Invalid device list');
        return;
      }
      callback(event, data);
    } catch (error) {
      console.warn('Unable to apply media device selection:', error);
    } finally {
      // Callback sends the selected device before this release message. IPC
      // ordering keeps the DOM target available until that selection arrives.
      releaseTarget();
    }
  };
  const timer = setTimeout(cleanup, timeoutMs);
  timer.unref?.();
  ipcMain.on('deviceList', onReply);
  sender.on('destroyed', cleanup);
  sender.on('render-process-gone', cleanup);
  sender.on('did-start-navigation', onNavigation);
  try {
    sender.send('postMessage', { getDeviceList: true, params, requestId });
  } catch (error) {
    cleanup();
    console.warn('Unable to request media devices:', error);
  }
  return cleanup;
}

const windowIpcHandlers = new WeakMap();

function onWindowIpc(ipcMain, window, channel, listener) {
  const handler = (event, ...args) => {
    if (!window.isDestroyed() && event.sender === window.webContents) listener(event, ...args);
  };
  ipcMain.on(channel, handler);
  let handlers = windowIpcHandlers.get(window);
  if (!handlers) {
    handlers = [];
    windowIpcHandlers.set(window, handlers);
    window.once('closed', () => {
      for (const entry of handlers) entry.ipcMain.removeListener(entry.channel, entry.handler);
      windowIpcHandlers.delete(window);
    });
  }
  handlers.push({ ipcMain, channel, handler });
}

function installDownloadHandler(window, args, app, platform = process.platform) {
  const contents = window.webContents;
  const session = contents.session;
  const handler = (_event, item, sender) => {
    if (window.isDestroyed() || sender !== contents) return;
    try {
      const currentArgs = window.args || args;
      if (!contents.getURL().includes('autorecord') && currentArgs.savefolder == null) return;
      // Preserve the existing Linux recording destination.
      const defaultFolder = platform === 'win32' || platform === 'darwin' ? 'downloads' : 'home';
      const folder = currentArgs.savefolder || app.getPath(defaultFolder);
      item.setSavePath(path.join(folder, item.getFilename()));
    } catch (error) {
      console.warn('Unable to set automatic download destination:', error);
    }
  };
  session.on('will-download', handler);
  window.once('closed', () => session.removeListener('will-download', handler));
}

module.exports = { onWindowIpc, installDownloadHandler, requestDeviceList };
