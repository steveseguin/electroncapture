'use strict';

// The native backend supports one capture at a time. Queue operations so a
// delayed stop cannot tear down a newer capture started by another window.
function createWindowAudioSession(getBackend, forward) {
  let active = null;
  let operations = Promise.resolve();
  const enqueue = operation => {
    const result = operations.then(operation);
    operations = result.catch(() => {});
    return result;
  };
  const failure = error => ({ success: false, error: error.message || String(error) });

  async function stopCurrent() {
    if (!active) return { success: true };
    const session = active;
    try {
      const result = await getBackend().stopStreamCapture();
      if (result && result.success === false) return result;
      active = null;
      session.detach();
      return { success: true };
    } catch (error) {
      return failure(error);
    }
  }

  function start(sender, target) {
    const backend = getBackend();
    if (!backend || typeof backend.startStreamCapture !== 'function') {
      return Promise.resolve(failure('window-audio-capture module unavailable'));
    }
    if (sender.isDestroyed()) return Promise.resolve(failure('Capture window closed'));
    const session = { sender, valid: true, sampleRate: 48000, channels: 2 };
    const invalidate = () => {
      session.valid = false;
      session.detach();
      enqueue(async () => {
        if (active !== session) return;
        const result = await stopCurrent();
        if (!result.success) console.warn('Window audio cleanup failed:', result.error);
      });
    };
    const onNavigation = (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) invalidate();
    };
    session.detach = () => {
      sender.removeListener('destroyed', invalidate);
      sender.removeListener('render-process-gone', invalidate);
      sender.removeListener('did-start-navigation', onNavigation);
    };
    sender.on('destroyed', invalidate);
    sender.on('render-process-gone', invalidate);
    sender.on('did-start-navigation', onNavigation);

    return enqueue(async () => {
      try {
        if (!session.valid) return failure('Capture page closed or navigated');
        const stopped = await stopCurrent();
        if (!stopped.success) return stopped;
        if (!session.valid) return failure('Capture page closed or navigated');
        active = session;
        let result;
        try {
          result = await backend.startStreamCapture(target.requestTarget, payload => {
            if (active === session && session.valid && !sender.isDestroyed()) {
              forward(sender, target.clientId, session.sampleRate, session.channels, payload);
            }
          });
        } catch (error) {
          session.valid = false;
          await stopCurrent();
          return failure(error);
        }
        if (!result || result.success === false || !session.valid) {
          const message = !session.valid ? 'Capture page closed or navigated' : result?.error || 'Failed to start window audio capture';
          session.valid = false;
          await stopCurrent();
          return failure(message);
        }
        session.sampleRate = result.sampleRate || 48000;
        session.channels = result.channels || 2;
        return {
          success: true, sampleRate: session.sampleRate, channels: session.channels,
          usingProcessSpecificLoopback: !!result.usingProcessSpecificLoopback,
        };
      } finally {
        if (active !== session) session.detach();
      }
    });
  }

  function stop(senderId = null) {
    return enqueue(() => {
      if (senderId !== null && active?.sender.id !== senderId) return { success: true };
      return stopCurrent();
    });
  }

  return { start, stop };
}

module.exports = { createWindowAudioSession };
