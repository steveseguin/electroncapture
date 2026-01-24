/**
 * Electron preload script for exposing ASIO API to renderer
 *
 * Usage in main.js:
 *   webPreferences: {
 *     preload: require.resolve('electron-asio/preload/asio-preload.js')
 *   }
 *
 * Or include in your own preload script:
 *   require('electron-asio/preload/asio-preload.js');
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose ASIO API to renderer
contextBridge.exposeInMainWorld('asio', {
    /**
     * Check if ASIO is available
     * @returns {Promise<boolean>}
     */
    isAvailable: () => ipcRenderer.invoke('asio:isAvailable'),

    /**
     * Get version info
     * @returns {Promise<string>}
     */
    getVersionInfo: () => ipcRenderer.invoke('asio:getVersionInfo'),

    /**
     * Get list of available ASIO devices
     * @returns {Promise<DeviceInfo[]>}
     */
    getDevices: () => ipcRenderer.invoke('asio:getDevices'),

    /**
     * Get device info by index or name
     * @param {number|string} deviceIndexOrName
     * @returns {Promise<DeviceInfo|null>}
     */
    getDeviceInfo: (deviceIndexOrName) => ipcRenderer.invoke('asio:getDeviceInfo', deviceIndexOrName),

    /**
     * Create and start a stream
     * @param {StreamConfig} config
     * @returns {Promise<{streamId: string, latency: number}>}
     */
    createStream: (config) => ipcRenderer.invoke('asio:createStream', config),

    /**
     * Start a stream
     * @param {string} streamId
     * @returns {Promise<boolean>}
     */
    startStream: (streamId) => ipcRenderer.invoke('asio:startStream', streamId),

    /**
     * Stop a stream
     * @param {string} streamId
     * @returns {Promise<boolean>}
     */
    stopStream: (streamId) => ipcRenderer.invoke('asio:stopStream', streamId),

    /**
     * Close a stream
     * @param {string} streamId
     * @returns {Promise<void>}
     */
    closeStream: (streamId) => ipcRenderer.invoke('asio:closeStream', streamId),

    /**
     * Get stream stats
     * @param {string} streamId
     * @returns {Promise<StreamStats>}
     */
    getStreamStats: (streamId) => ipcRenderer.invoke('asio:getStreamStats', streamId),

    /**
     * Write audio data to a stream's output
     * @param {string} streamId
     * @param {Float32Array[]} buffers
     * @returns {Promise<number>}
     */
    writeStream: (streamId, buffers) => {
        // Convert Float32Arrays to regular arrays for IPC
        const serialized = buffers.map(buf => Array.from(buf));
        return ipcRenderer.invoke('asio:writeStream', streamId, serialized);
    },

    /**
     * Subscribe to audio data from a stream
     * @param {Function} callback - (streamId, inputBuffers) => void
     * @returns {Function} Unsubscribe function
     */
    onAudioData: (callback) => {
        const handler = (event, { streamId, buffers }) => {
            // Convert arrays back to Float32Arrays
            const float32Buffers = buffers.map(arr => new Float32Array(arr));
            callback(streamId, float32Buffers);
        };
        ipcRenderer.on('asio:audioData', handler);
        return () => ipcRenderer.removeListener('asio:audioData', handler);
    },

    /**
     * Subscribe to stream errors
     * @param {Function} callback - (streamId, error) => void
     * @returns {Function} Unsubscribe function
     */
    onError: (callback) => {
        const handler = (event, { streamId, error }) => callback(streamId, error);
        ipcRenderer.on('asio:error', handler);
        return () => ipcRenderer.removeListener('asio:error', handler);
    }
});

console.log('[electron-asio] Preload script loaded - window.asio API available');
