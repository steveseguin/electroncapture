/**
 * IPC handlers for Electron main process
 *
 * Usage in main.js:
 *   const { setupAsioIpc } = require('electron-asio/preload/ipc-handlers');
 *   setupAsioIpc(ipcMain);
 */

const asio = require('../lib/index.js');

// Store active streams
const streams = new Map();
const owners = new Map();
let streamIdCounter = 0;

function closeStream(streamId) {
    const entry = streams.get(streamId);
    if (!entry) return;
    // Remove first so callbacks already queued by the native module are ignored.
    streams.delete(streamId);
    const owner = owners.get(entry.sender);
    owner.ids.delete(streamId);
    if (!owner.ids.size) {
        for (const [name, listener] of owner.listeners) entry.sender.removeListener(name, listener);
        owners.delete(entry.sender);
    }
    entry.stream.close();
}

function trackStream(streamId, stream, sender) {
    let owner = owners.get(sender);
    if (!owner) {
        const cleanup = () => {
            for (const id of [...owner.ids]) {
                try { closeStream(id); }
                catch (error) { console.error(`Error closing ASIO stream ${id}:`, error); }
            }
        };
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
    owner.ids.add(streamId);
    streams.set(streamId, { stream, sender });
}

/**
 * Generate unique stream ID
 */
function generateStreamId() {
    return `stream_${++streamIdCounter}_${Date.now()}`;
}

/**
 * Set up IPC handlers for ASIO
 * @param {Electron.IpcMain} ipcMain
 */
function setupAsioIpc(ipcMain) {
    // Basic queries
    ipcMain.handle('asio:isAvailable', () => {
        return asio.isAvailable();
    });

    ipcMain.handle('asio:getVersionInfo', () => {
        return asio.getVersionInfo();
    });

    ipcMain.handle('asio:getDevices', () => {
        return asio.getDevices();
    });

    ipcMain.handle('asio:getDeviceInfo', (event, deviceIndexOrName) => {
        return asio.getDeviceInfo(deviceIndexOrName);
    });

    // Stream management
    ipcMain.handle('asio:createStream', (event, config) => {
        if (event.sender.isDestroyed()) throw new Error('Capture window closed');
        const stream = asio.createStream(config);
        const streamId = generateStreamId();

        trackStream(streamId, stream, event.sender);

        try {
            // Set up callback to forward audio data to renderer
            stream.setProcessCallback((inputBuffers, outputBuffers) => {
                // Only send input data to renderer (output should be handled via write)
                if (streams.has(streamId) && inputBuffers.length > 0 && !event.sender.isDestroyed()) {
                    // Convert Float32Arrays to regular arrays for IPC
                    const serialized = inputBuffers.map(buf => Array.from(buf));
                    event.sender.send('asio:audioData', { streamId, buffers: serialized });
                }
            });

            stream.on('error', (error) => {
                if (streams.has(streamId) && !event.sender.isDestroyed()) {
                    event.sender.send('asio:error', { streamId, error: error.message });
                }
            });

            return {
                streamId,
                inputLatency: stream.inputLatency,
                outputLatency: stream.outputLatency,
                totalLatency: stream.totalLatency,
                sampleRate: stream.sampleRate,
                bufferSize: stream.bufferSize,
                inputChannelCount: stream.inputChannelCount,
                outputChannelCount: stream.outputChannelCount
            };
        } catch (error) {
            try { closeStream(streamId); }
            catch (closeError) { console.error('ASIO startup cleanup failed:', closeError); }
            throw error;
        }
    });

    ipcMain.handle('asio:startStream', (event, streamId) => {
        const entry = streams.get(streamId);
        if (!entry) throw new Error(`Stream not found: ${streamId}`);
        return entry.stream.start();
    });

    ipcMain.handle('asio:stopStream', (event, streamId) => {
        const entry = streams.get(streamId);
        if (!entry) throw new Error(`Stream not found: ${streamId}`);
        return entry.stream.stop();
    });

    ipcMain.handle('asio:closeStream', (event, streamId) => {
        closeStream(streamId);
    });

    ipcMain.handle('asio:getStreamStats', (event, streamId) => {
        const entry = streams.get(streamId);
        if (!entry) throw new Error(`Stream not found: ${streamId}`);
        return entry.stream.stats;
    });

    ipcMain.handle('asio:writeStream', (event, streamId, buffers) => {
        const entry = streams.get(streamId);
        if (!entry) throw new Error(`Stream not found: ${streamId}`);

        // Convert arrays back to Float32Arrays
        const float32Buffers = buffers.map(arr => new Float32Array(arr));
        return entry.stream.write(float32Buffers);
    });
}

/**
 * Clean up all streams (call on app quit)
 */
function cleanupAsio() {
    for (const [streamId, entry] of streams) {
        try {
            closeStream(streamId);
        } catch (e) {
            console.error(`Error closing stream ${streamId}:`, e);
        }
    }
    streams.clear();
    asio.terminate();
}

module.exports = {
    setupAsioIpc,
    cleanupAsio
};
