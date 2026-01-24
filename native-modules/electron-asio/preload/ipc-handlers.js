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
let streamIdCounter = 0;

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
        const stream = asio.createStream(config);
        const streamId = generateStreamId();

        streams.set(streamId, {
            stream,
            sender: event.sender
        });

        // Set up callback to forward audio data to renderer
        stream.setProcessCallback((inputBuffers, outputBuffers) => {
            // Only send input data to renderer (output should be handled via write)
            if (inputBuffers.length > 0 && !event.sender.isDestroyed()) {
                // Convert Float32Arrays to regular arrays for IPC
                const serialized = inputBuffers.map(buf => Array.from(buf));
                event.sender.send('asio:audioData', { streamId, buffers: serialized });
            }
        });

        stream.on('error', (error) => {
            if (!event.sender.isDestroyed()) {
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
        const entry = streams.get(streamId);
        if (!entry) return;
        entry.stream.close();
        streams.delete(streamId);
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
            entry.stream.close();
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
