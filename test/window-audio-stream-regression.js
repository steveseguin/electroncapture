'use strict';
const assert = require('node:assert/strict');
const WindowAudioStream = require('../window-audio-stream');

async function main() {
  let stopCount = 0;
  let closeCount = 0;
  let unsubscribeCount = 0;
  let onData;
  let contextOptions;
  let failDestination = false;
  global.window = {
    electronApi: {
      startStreamCapture: async () => ({ success: true, sampleRate: 44100, channels: 2 }),
      stopStreamCapture: async () => { stopCount++; },
      onAudioStreamData: cb => { onData = cb; return () => { unsubscribeCount++; }; },
    },
    AudioContext: class {
      constructor(options) { contextOptions = options; this.state = 'suspended'; }
      async resume() { this.state = 'running'; }
      async close() { this.state = 'closed'; closeCount++; }
      createMediaStreamDestination() {
        if (failDestination) throw new Error('destination failed');
        return { stream: { getTracks: () => [{ stop() {} }] } };
      }
      createScriptProcessor() { return { connect() {}, disconnect() {} }; }
    },
  };
  const capture = new WindowAudioStream();
  assert.deepEqual(capture._prepareTarget('00123'), { requestTarget: 123, clientId: '123' });
  await capture.start(123);
  assert.equal(contextOptions.sampleRate, 44100, 'use the native rate, not a stale default');
  assert.equal(capture.audioContext.state, 'running');
  // A large packet used to throw RangeError from push(...samples). A second
  // packet must evict old audio instead of adding seconds of stale latency.
  onData({ clientId: '123', data: { samples: new Float32Array(300000).fill(0.25) } });
  onData({ clientId: '123', data: { samples: new Float32Array(88200).fill(0.75) } });
  const output = [new Float32Array(4096), new Float32Array(4096)];
  capture.scriptProcessor.onaudioprocess({ outputBuffer: {
    numberOfChannels: 2, length: 4096, getChannelData: channel => output[channel],
  } });
  assert.equal(output[0][0], 0.75);
  const render = () => capture.scriptProcessor.onaudioprocess({ outputBuffer: {
    numberOfChannels: 2, length: 4096, getChannelData: channel => output[channel],
  } });
  // Drain the earlier latency-cap fixture before checking underrun behavior.
  for (let i = 0; i < 12; i++) render();
  onData({ clientId: '123', data: { samples: new Float32Array([0.25, 0.5, 0.75]) } });
  render();
  assert.equal(output[0][0], 0.25, 'play available audio instead of silencing the whole block');
  assert.equal(output[1][0], 0.5);
  assert.equal(output[0][1], 0, 'only the missing tail is silent');
  onData({ clientId: '123', data: { samples: new Float32Array([1]) } });
  render();
  assert.equal(output[0][0], 0.75, 'retain a partial interleaved frame until its other channel arrives');
  assert.equal(output[1][0], 1);
  const oversized = Float32Array.from({ length: 88203 }, (_, i) => i % 2 ? 0.75 : 0.25);
  onData({ clientId: '123', data: { samples: oversized } });
  render();
  assert.equal(output[0][0], 0.25, 'overflow discards whole frames without shifting channel alignment');
  assert.equal(output[1][0], 0.75);
  for (let i = 0; i < 12; i++) render();
  const continuation = Float32Array.from({ length: 88203 }, (_, i) => i % 2 ? 0.25 : 0.75);
  onData({ clientId: '123', data: { samples: continuation } });
  render();
  assert.equal(output[0][0], 0.25, 'overflow remains aligned when the old buffer holds a partial frame');
  assert.equal(output[1][0], 0.75);
  await capture.stop();
  assert.equal(unsubscribeCount, 1);
  assert.equal(closeCount, 1);
  failDestination = true;
  await assert.rejects(capture.start(456), /destination failed/);
  assert.equal(stopCount, 2, 'failed Web Audio setup must stop native capture');
  assert.equal(closeCount, 2);
  assert.equal(capture.currentProcessId, null);
  assert.equal(capture.isCapturing(), false);
  failDestination = false;
  let finishStart;
  let starts = 0;
  window.electronApi.startStreamCapture = () => {
    starts++;
    return new Promise(resolve => { finishStart = resolve; });
  };
  const pendingStart = capture.start(789);
  const pendingStop = capture.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(starts, 1);
  assert.equal(stopCount, 2, 'stop waits for native startup');
  finishStart({ success: true, sampleRate: 48000, channels: 2 });
  await Promise.all([pendingStart, pendingStop]);
  assert.equal(stopCount, 3);
  assert.equal(closeCount, 3);
  assert.equal(capture.isCapturing(), false, 'a delayed start cannot resurrect a stopped stream');
  window.electronApi.startStreamCapture = async () => ({ success: true, sampleRate: 48000, channels: 2 });
  const oldStream = await capture.start(100);
  const replacement = capture.start(200);
  const delayedCleanup = capture.stop(oldStream);
  const newStream = await replacement;
  await delayedCleanup;
  assert.equal(capture.getStream(), newStream);
  assert.equal(capture.isCapturing(), true, 'ownership is checked after queued replacement startup');
  await capture.stop(newStream);
  assert.equal(capture.isCapturing(), false);

  let trackStops = 0;
  const originalProcessor = window.AudioContext.prototype.createScriptProcessor;
  window.AudioContext.prototype.createMediaStreamDestination = () => ({
    stream: { getTracks: () => [{ stop() { trackStops++; } }] },
  });
  window.AudioContext.prototype.createScriptProcessor = () => { throw new Error('processor failed'); };
  await assert.rejects(capture.start(300), /processor failed/);
  assert.equal(trackStops, 1, 'processor setup failure releases the destination track');
  assert.equal(capture.audioContext, null);
  assert.equal(capture.getStream(), null);
  window.AudioContext.prototype.createScriptProcessor = originalProcessor;

  window.electronApi.onAudioStreamData = cb => {
    onData = cb;
    return () => { throw new Error('unsubscribe failed'); };
  };
  await capture.start(400);
  const staleCallback = onData;
  const oldProcessor = capture.scriptProcessor;
  oldProcessor.disconnect = () => { throw new Error('disconnect failed'); };
  capture.audioContext.close = async () => { throw new Error('close failed'); };
  await capture.stop();
  assert.equal(oldProcessor.onaudioprocess, null);
  for (const field of ['audioStream', 'audioContext', 'scriptProcessor', 'cleanupCallback']) {
    assert.equal(capture[field], null, `${field} is cleared despite cleanup errors`);
  }
  assert.equal(trackStops, 2, 'one failing cleanup operation must not skip other resources');
  window.electronApi.onAudioStreamData = cb => { onData = cb; return () => {}; };
  await capture.start(400);
  staleCallback({ clientId: '400', data: { samples: [1, 1], sampleRate: 22050 } });
  assert.equal(capture.sampleRate, 48000, 'a leaked old callback cannot mutate a replacement capture');
  await capture.stop();
  delete global.window;
  console.log('Window audio stream regression checks passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
