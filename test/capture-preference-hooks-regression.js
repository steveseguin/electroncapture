'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {
  normalizeCapturePreferences,
  resolveWindowCapturePreferences,
  serializeCapturePreferences
} = require('../capture-preference-hooks');

const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const hookStartMarker = '// CAPTURE_PREFERENCE_HOOK_START';
const hookEndMarker = '// CAPTURE_PREFERENCE_HOOK_END';
const hookStart = preloadSource.indexOf(hookStartMarker);
const hookEnd = preloadSource.indexOf(hookEndMarker);
assert.ok(hookStart >= 0 && hookEnd > hookStart, 'preload capture hook markers must exist');
const hookSource = preloadSource.slice(hookStart + hookStartMarker.length, hookEnd).trim();
const installCapturePreferenceHooks = vm.runInThisContext(`(${hookSource})`);

class FakeMediaDevices {
  getDisplayMedia(...args) {
    this.lastArguments = args;
    return Promise.resolve({ id: 'display-stream' });
  }
}

class FakeRTCPeerConnection {
  constructor(receivers) {
    this.receivers = receivers;
  }

  getReceivers() {
    if (this.failGetReceivers) {
      throw new Error('getReceivers failed');
    }
    return this.receivers;
  }

  setRemoteDescription(description) {
    this.remoteDescription = description;
    return Promise.resolve('applied');
  }
}

async function run() {
  const fakeGlobal = {
    MediaDevices: FakeMediaDevices,
    RTCPeerConnection: FakeRTCPeerConnection
  };
  installCapturePreferenceHooks({ hideCursorCapture: true, playoutDelay: 30 }, fakeGlobal);

  const mediaDevices = new FakeMediaDevices();
  const originalConstraints = Object.freeze({
    video: Object.freeze({ width: 1920 }),
    audio: true
  });
  await mediaDevices.getDisplayMedia(originalConstraints);
  assert.deepEqual(mediaDevices.lastArguments[0], {
    video: { width: 1920, cursor: 'never' },
    audio: true
  });
  assert.equal(originalConstraints.video.cursor, undefined, 'caller constraints must not be mutated');

  await mediaDevices.getDisplayMedia({ video: { cursor: 'always' } });
  assert.equal(mediaDevices.lastArguments[0].video.cursor, 'always', 'explicit cursor choices must win');

  await mediaDevices.getDisplayMedia({ video: true });
  assert.deepEqual(mediaDevices.lastArguments[0], { video: { cursor: 'never' } });

  const videoReceiver = { track: { kind: 'video' }, playoutDelayHint: 0 };
  const audioReceiver = { track: { kind: 'audio' }, playoutDelayHint: 0 };
  const peerConnection = new FakeRTCPeerConnection([videoReceiver, audioReceiver]);
  assert.equal(await peerConnection.setRemoteDescription({ type: 'offer' }), 'applied');
  assert.equal(videoReceiver.playoutDelayHint, 30);
  assert.equal(audioReceiver.playoutDelayHint, 0);

  videoReceiver.playoutDelayHint = 45;
  peerConnection.getReceivers();
  assert.equal(videoReceiver.playoutDelayHint, 45, 'a later explicit page value must not be overwritten');

  installCapturePreferenceHooks({ hideCursorCapture: false, playoutDelay: 120 }, fakeGlobal);
  videoReceiver.playoutDelayHint = 0;
  await peerConnection.setRemoteDescription({ type: 'answer' });
  assert.equal(videoReceiver.playoutDelayHint, 120, 'reinstall must update the next remote description');

  peerConnection.failGetReceivers = true;
  assert.equal(
    await peerConnection.setRemoteDescription({ type: 'answer' }),
    'applied',
    'preference hook failures must not reject a successful remote description'
  );
  peerConnection.failGetReceivers = false;

  await mediaDevices.getDisplayMedia({ video: true });
  assert.deepEqual(mediaDevices.lastArguments[0], { video: true }, 'disabled cursor suppression must pass through');

  const serializedGlobal = {
    MediaDevices: class SerializedMediaDevices {
      getDisplayMedia(constraints) {
        this.constraints = constraints;
        return Promise.resolve();
      }
    },
    RTCPeerConnection: class SerializedRTCPeerConnection {
      getReceivers() {
        return [];
      }
    }
  };
  serializedGlobal.globalThis = serializedGlobal;
  const serializedInstaller = vm.runInNewContext(`(${installCapturePreferenceHooks.toString()})`, serializedGlobal);
  serializedInstaller({ hideCursorCapture: true, playoutDelay: 10 });
  const serializedMediaDevices = new serializedGlobal.MediaDevices();
  await serializedMediaDevices.getDisplayMedia({ video: true });
  assert.equal(serializedMediaDevices.constraints.video.cursor, 'never', 'serialized page-world hook must work');

  const firstWindow = normalizeCapturePreferences({ hideCursorCapture: true, playoutDelay: 30 });
  const secondWindow = normalizeCapturePreferences({ hideCursorCapture: false, playoutDelay: 240 });
  assert.deepEqual(firstWindow, {
    hideCursorCapture: true,
    playoutDelay: 30,
    disableAdaptiveScaling: false,
    lockResolution: false,
    lockFramerate: false
  });
  assert.equal(secondWindow.hideCursorCapture, false);
  assert.equal(secondWindow.playoutDelay, 240);
  assert.notEqual(serializeCapturePreferences(firstWindow), serializeCapturePreferences(secondWindow));
  assert.equal(resolveWindowCapturePreferences({ args: firstWindow }, secondWindow).playoutDelay, 30);
  assert.equal(resolveWindowCapturePreferences({ args: secondWindow }, firstWindow).playoutDelay, 240);

  console.log('Capture preference hook regression checks passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
