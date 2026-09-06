'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class Track extends EventTarget {
  constructor() { super(); this.readyState = 'live'; }
  stop() { this.readyState = 'ended'; }
  end() { this.stop(); this.dispatchEvent(new Event('ended')); }
  clone() { return new Track(); }
}
class Share extends EventTarget {
  constructor() { super(); this.video = new Track(); this.audio = []; }
  getVideoTracks() { return [this.video]; }
  addTrack(track) { this.audio.push(track); }
  removeTrack(track) { this.audio = this.audio.filter(item => item !== track); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '../preload.js'), 'utf8');
  const start = source.indexOf('let appAudioAttachmentGeneration = 0;');
  const end = source.indexOf('function installDisplayMediaHook()', start);
  assert.ok(start >= 0 && end > start);
  let current = null, stopCount = 0, resolveStart;
  const starts = [];
  const audio = () => ({ getAudioTracks: () => [new Track()] });
  const instance = {
    async start(target) { starts.push(target); current = audio(); return current; },
    async stop(expected) {
      if (expected === undefined || current === expected) { current = null; stopCount++; }
    },
  };
  const context = { console, appAudioTarget: 'first', windowAudioStreamInstance: instance,
    ensureWindowAudioStreamInstance: () => instance, sanitizeAppAudioTarget: value => value };
  const api = vm.runInNewContext(source.slice(start, end) + '\n({ attachApplicationAudio, updateAppAudioTarget });', context);

  const oldShare = new Share(), newShare = new Share();
  await api.attachApplicationAudio(oldShare);
  await api.attachApplicationAudio(newShare);
  const newAudio = current;
  oldShare.video.end();
  await tick();
  assert.equal(current, newAudio, 'old display share cleanup cannot stop replacement audio');
  assert.equal(oldShare.audio.length, 0);
  newShare.video.end();
  newShare.dispatchEvent(new Event('inactive'));
  await tick();
  assert.equal(stopCount, 1, 'multiple ending events clean up once');
  assert.equal(newShare.audio.length, 0);

  instance.start = async target => {
    starts.push(target);
    return new Promise(resolve => { resolveStart = () => { current = audio(); resolve(current); }; });
  };
  const pendingShare = new Share();
  const pending = api.attachApplicationAudio(pendingShare);
  pendingShare.video.end();
  resolveStart();
  await pending;
  assert.equal(current, null, 'capture that finishes after display ended must stop');
  assert.equal(pendingShare.audio.length, 0);
  const retargetedShare = new Share();
  const retargeted = api.attachApplicationAudio(retargetedShare);
  api.updateAppAudioTarget('second');
  resolveStart();
  await retargeted;
  assert.equal(retargetedShare.audio.length, 0, 'old target must not attach after retargeting');
  assert.equal(current, null);

  instance.start = async () => { current = audio(); return current; };
  const failedShare = new Share();
  let failedClone;
  failedShare.addTrack = track => { failedClone = track; throw new Error('track attachment failed'); };
  await api.attachApplicationAudio(failedShare);
  assert.equal(failedClone.readyState, 'ended');
  assert.equal(current, null);
  const alreadyEnded = new Share();
  alreadyEnded.video.stop();
  await api.attachApplicationAudio(alreadyEnded);
  assert.equal(current, null, 'already ended display must not start audio');
  console.log('Application audio attachment regression checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
