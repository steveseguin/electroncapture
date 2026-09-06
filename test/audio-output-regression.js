'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const begin = source.indexOf('const sinkUpdates = new WeakMap();');
  const end = source.indexOf('function enumerateDevicesThirdParty()', begin);
  assert.ok(begin >= 0 && end > begin);
  const calls = [];
  let finish;
  const element = { setSinkId: id => {
    calls.push(id);
    return new Promise(resolve => { finish = resolve; });
  } };
  const context = { console: { warn() {} }, document: null };
  const api = vm.runInNewContext(source.slice(begin, end) + '\n({setSink, changeAudioOutputDeviceByIdThirdParty});', context);
  const first = api.setSink(element, 'headphones', true);
  const second = api.setSink(element, '', true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['headphones']);
  assert.equal(element.manualSink, undefined, 'pending selections are not remembered as successes');
  finish();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['headphones', '']);
  finish();
  await second;
  assert.equal(element.manualSink, '');
  element.setSinkId = async id => { calls.push(id); };
  await api.setSink(element, 'page-wide-device');
  assert.equal(calls.at(-1), '', 'system default is a valid manual override');
  element.setSinkId = async () => { throw new Error('device unplugged'); };
  assert.equal(await api.setSink(element, 'missing', true), false);
  assert.equal(element.manualSink, '', 'failed changes preserve the last successful override');
  assert.equal(await api.setSink(null, 'device', true), false);

  const routed = [];
  const media = name => ({ setSinkId: async id => routed.push([name, id]) });
  const doc = (elements, frames = []) => ({ querySelectorAll: query => query === 'audio, video' ? elements : frames });
  const nested = doc([media('nested')]);
  const child = doc([media('child')], [{ contentDocument: nested }]);
  const inaccessible = { get contentDocument() { throw new Error('inaccessible'); } };
  context.document = doc([media('parent')], [inaccessible, { contentDocument: child }]);
  api.changeAudioOutputDeviceByIdThirdParty('speakers');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(routed, [['parent', 'speakers'], ['child', 'speakers'], ['nested', 'speakers']]);
  console.log('Audio output routing regression checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
