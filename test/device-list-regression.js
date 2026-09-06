'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { requestDeviceList } = require('../window-lifecycle');

async function main() {
  const ipc = new EventEmitter();
  const makeWindow = () => ({ isDestroyed: () => false, webContents: Object.assign(new EventEmitter(), {
    isDestroyed: () => false, send(_channel, request) { this.requests.push(request); }, requests: [],
  }) });
  const a = makeWindow(), b = makeWindow();
  const replies = [];
  const request = (window, label, timeout = 15000) => requestDeviceList(ipc, window, { x: 0, y: 0 }, () => replies.push(label), timeout);
  const reply = (window, id) => ipc.emit('deviceList', { sender: window.webContents }, { requestId: id, deviceInfos: [] });
  request(a, 'first');
  request(a, 'second');
  request(b, 'other');
  const first = a.webContents.requests[0].requestId;
  reply(b, first);
  assert.deepEqual(replies, []);
  reply(a, a.webContents.requests[1].requestId);
  assert.deepEqual(replies, ['second']);
  reply(a, first);
  assert.deepEqual(replies, ['second', 'first']);
  assert.equal(a.webContents.requests.at(-1).releaseDeviceList, first);
  reply(b, b.webContents.requests[0].requestId);
  assert.deepEqual(replies, ['second', 'first', 'other']);
  assert.equal(ipc.listenerCount('deviceList'), 0);
  request(a, 'timeout', 5);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(ipc.listenerCount('deviceList'), 0);
  assert.equal(a.webContents.listenerCount('destroyed'), 0);
  assert.ok(a.webContents.requests.at(-1).releaseDeviceList, 'timeout releases the renderer target');
  request(a, 'navigate');
  a.webContents.emit('did-start-navigation', {}, 'url', false, true);
  assert.equal(ipc.listenerCount('deviceList'), 0);
  request(a, 'destroy');
  a.webContents.emit('destroyed');
  assert.equal(ipc.listenerCount('deviceList'), 0);
  request(a, 'crash');
  a.webContents.emit('render-process-gone');
  assert.equal(ipc.listenerCount('deviceList'), 0);
  a.webContents.send = (_channel, data) => reply(a, data.requestId);
  request(a, 'immediate');
  assert.equal(replies.at(-1), 'immediate', 'listen before sending the request');
  assert.equal(ipc.listenerCount('deviceList'), 0);
  const source = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const begin = source.indexOf('\t\tif ("getDeviceList" in args[0]) {');
  const end = source.indexOf('\t\tif ("changeVideoDevice"', begin);
  assert.ok(begin >= 0 && end > begin);
  const sent = [];
  const context = {
    deviceListElements: new Map(),
    args: [{ getDeviceList: true, requestId: 'test', params: { x: 0, y: 0 } }],
    document: { elementFromPoint: () => null },
    enumerateDevices: async () => [],
    ipcRenderer: { send: (channel, data) => sent.push({ channel, data }) },
  };
  vm.runInNewContext(source.slice(begin, end), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent[0].data.requestId, 'test');
  assert.equal(sent[0].data.eleId, false, 'empty page area is a valid menu target');
  context.enumerateDevices = () => { throw new Error('enumeration failed'); };
  vm.runInNewContext(source.slice(begin, end), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent[1].data.error, 'enumeration failed');
  const firstElement = { name: 'first video' }, secondElement = { name: 'second video' };
  context.enumerateDevices = async () => [];
  context.document.elementFromPoint = () => firstElement;
  context.args = [{ getDeviceList: true, requestId: 'first-element', params: { x: 0, y: 0 } }];
  vm.runInNewContext(source.slice(begin, end), context);
  context.document.elementFromPoint = () => secondElement;
  context.args = [{ getDeviceList: true, requestId: 'second-element', params: { x: 1, y: 1 } }];
  vm.runInNewContext(source.slice(begin, end), context);
  await new Promise(resolve => setImmediate(resolve));
  const routed = [];
  context.setSink = (element, device) => routed.push([element, device]);
  const routeStart = source.indexOf('\t\tif ("changeAudioOutputDevice" in args[0]) {');
  const routeEnd = source.indexOf('\t} catch(e){', routeStart);
  context.args = [{ changeAudioOutputDevice: 'speakers', data: { requestId: 'first-element' } }];
  vm.runInNewContext(source.slice(routeStart, routeEnd), context);
  assert.equal(routed[0][0], firstElement, 'overlapping menus retain independent DOM targets');
  context.args = [{ releaseDeviceList: 'first-element' }];
  vm.runInNewContext(source.slice(begin, end), context);
  assert.equal(context.deviceListElements.has('first-element'), false);
  assert.equal(context.deviceListElements.get('second-element'), secondElement);
  const c = makeWindow();
  requestDeviceList(ipc, c, {}, (_event, data) => {
    c.webContents.send('postMessage', { changeAudioOutputDevice: 'speakers', data });
  });
  reply(c, c.webContents.requests[0].requestId);
  assert.equal(c.webContents.requests[1].changeAudioOutputDevice, 'speakers');
  assert.ok(c.webContents.requests[2].releaseDeviceList, 'release follows the selection message');
  const failing = makeWindow();
  requestDeviceList(ipc, failing, {}, () => { throw new Error('dialog failed'); });
  assert.doesNotThrow(() => reply(failing, failing.webContents.requests[0].requestId));
  assert.ok(failing.webContents.requests.at(-1).releaseDeviceList, 'failed selections release their DOM target');
  assert.equal(ipc.listenerCount('deviceList'), 0);

  const mainSource = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const callbacks = [...mainSource.matchAll(/requestDeviceList\(ipcMain, browserWindow, params, (\(event, data\) => \{[\s\S]*?\n\t{6}\})\)/g)];
  assert.equal(callbacks.length, 4);
  for (const [, callbackSource] of callbacks) {
    for (const [selection, destroyed] of [[0, false], [-1, false], [9, false], [1, true], [1, false]]) {
      const messages = [];
      const callback = vm.runInNewContext(`(${callbackSource})`, {
        buttons: ['Cancel'], details: [false], console: { log() {} },
        dialog: { showMessageBoxSync: () => selection },
        browserWindow: {
          isDestroyed: () => destroyed,
          get webContents() {
            assert.equal(destroyed, false, 'closed windows must not be dereferenced');
            return { isDestroyed: () => false, send: (...args) => messages.push(args) };
          },
        },
      });
      callback({}, { deviceInfos: ['audiooutput', 'audioinput', 'videoinput'].map(kind => ({ kind, label: kind, deviceId: kind })) });
      assert.equal(messages.length, selection === 1 && !destroyed ? 1 : 0);
    }
  }
  let finishEnumeration;
  context.enumerateDevices = () => new Promise(resolve => { finishEnumeration = resolve; });
  context.args = [{ getDeviceList: true, requestId: 'late', params: { x: 0, y: 0 } }];
  vm.runInNewContext(source.slice(begin, end), context);
  await new Promise(resolve => setImmediate(resolve));
  const beforeLateReply = sent.length;
  context.args = [{ releaseDeviceList: 'late' }];
  vm.runInNewContext(source.slice(begin, end), context);
  finishEnumeration([]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, beforeLateReply, 'released requests must not send late enumeration results');
  let stopped = 0;
  const requestOutputAudioStream = vm.runInNewContext(`(${source.slice(source.indexOf('async function requestOutputAudioStream()'))})`, {
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) } },
    enumerateDevicesThirdParty: async () => { throw new Error('enumeration failed'); },
  });
  await assert.rejects(requestOutputAudioStream(), /enumeration failed/);
  assert.equal(stopped, 1, 'temporary microphone stream closes on enumeration failure');
  console.log('Device menu request regression checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
