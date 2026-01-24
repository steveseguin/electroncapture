/**
 * electron-asio - Native ASIO audio support for Electron
 *
 * Provides low-latency full-duplex audio I/O using ASIO drivers on Windows.
 */

const path = require('path');
const EventEmitter = require('events');

// Load native addon
let native = null;
try {
    native = require('../build/Release/electron_asio.node');
} catch (e) {
    try {
        native = require('../build/Debug/electron_asio.node');
    } catch (e2) {
        console.warn('[electron-asio] Native module not available:', e.message);
    }
}

/**
 * Check if ASIO is available on this system
 * @returns {boolean}
 */
function isAvailable() {
    if (!native) return false;
    try {
        return native.isAvailable();
    } catch (e) {
        return false;
    }
}

/**
 * Get version information
 * @returns {string}
 */
function getVersionInfo() {
    if (!native) return 'ASIO module not loaded';
    try {
        return native.getVersionInfo();
    } catch (e) {
        return 'Unknown version';
    }
}

/**
 * Get list of available ASIO devices
 * @returns {DeviceInfo[]}
 */
function getDevices() {
    if (!native) return [];
    try {
        return native.getDevices();
    } catch (e) {
        console.error('[electron-asio] Failed to get devices:', e);
        return [];
    }
}

/**
 * Get info for a specific device
 * @param {number|string} deviceIndexOrName - Device index or name
 * @returns {DeviceInfo|null}
 */
function getDeviceInfo(deviceIndexOrName) {
    if (!native) return null;
    try {
        return native.getDeviceInfo(deviceIndexOrName);
    } catch (e) {
        console.error('[electron-asio] Failed to get device info:', e);
        return null;
    }
}

/**
 * AsioStream class - wraps the native stream with EventEmitter
 */
class AsioStream extends EventEmitter {
    /**
     * Create a new ASIO stream
     * @param {StreamConfig} config
     */
    constructor(config) {
        super();
        if (!native) {
            throw new Error('ASIO native module not available');
        }
        this._native = new native.AsioStream(config);
        this._config = config;
        this._processCallback = null;
    }

    /**
     * Start the stream
     * @returns {boolean}
     */
    start() {
        return this._native.start();
    }

    /**
     * Stop the stream
     * @returns {boolean}
     */
    stop() {
        return this._native.stop();
    }

    /**
     * Close and release the stream
     */
    close() {
        this._native.close();
        this.emit('close');
    }

    /**
     * Set the audio processing callback
     *
     * The callback receives input buffers and must fill output buffers.
     * This is called from the audio thread for minimum latency.
     *
     * @param {Function} callback - (inputBuffers: Float32Array[], outputBuffers: Float32Array[]) => void
     */
    setProcessCallback(callback) {
        this._processCallback = callback;
        this._native.setProcessCallback((inputBuffers, outputBuffers) => {
            try {
                callback(inputBuffers, outputBuffers);
            } catch (e) {
                this.emit('error', e);
            }
        });
    }

    /**
     * Write audio data to output (for async/event-based mode)
     * @param {Float32Array[]} buffers - Array of channel buffers
     * @returns {number} Frames written
     */
    write(buffers) {
        return this._native.write(buffers);
    }

    /**
     * Check if stream is currently running
     * @returns {boolean}
     */
    get isRunning() {
        return this._native.isRunning;
    }

    /**
     * Get input latency in milliseconds
     * @returns {number}
     */
    get inputLatency() {
        return this._native.inputLatency;
    }

    /**
     * Get output latency in milliseconds
     * @returns {number}
     */
    get outputLatency() {
        return this._native.outputLatency;
    }

    /**
     * Get total round-trip latency in milliseconds
     * @returns {number}
     */
    get totalLatency() {
        return this.inputLatency + this.outputLatency;
    }

    /**
     * Get sample rate
     * @returns {number}
     */
    get sampleRate() {
        return this._native.sampleRate;
    }

    /**
     * Get buffer size in frames
     * @returns {number}
     */
    get bufferSize() {
        return this._native.bufferSize;
    }

    /**
     * Get number of input channels
     * @returns {number}
     */
    get inputChannelCount() {
        return this._native.inputChannelCount;
    }

    /**
     * Get number of output channels
     * @returns {number}
     */
    get outputChannelCount() {
        return this._native.outputChannelCount;
    }

    /**
     * Get stream statistics
     * @returns {StreamStats}
     */
    get stats() {
        return this._native.stats;
    }

    /**
     * Get buffer size in milliseconds
     * @returns {number}
     */
    get bufferDuration() {
        return (this.bufferSize / this.sampleRate) * 1000;
    }
}

/**
 * Create a new ASIO stream
 * @param {StreamConfig} config
 * @returns {AsioStream}
 */
function createStream(config) {
    return new AsioStream(config);
}

/**
 * Initialize the ASIO subsystem (called automatically on load)
 * @returns {boolean}
 */
function initialize() {
    if (!native) return false;
    try {
        return native.initialize();
    } catch (e) {
        console.error('[electron-asio] Initialize failed:', e);
        return false;
    }
}

/**
 * Terminate the ASIO subsystem (call on app exit)
 */
function terminate() {
    if (!native) return;
    try {
        native.terminate();
    } catch (e) {
        console.warn('[electron-asio] Terminate error:', e);
    }
}

// Export everything
module.exports = {
    // Functions
    isAvailable,
    getVersionInfo,
    getDevices,
    getDeviceInfo,
    createStream,
    initialize,
    terminate,

    // Classes
    AsioStream,

    // Native module (for advanced use)
    native
};

/**
 * @typedef {Object} DeviceInfo
 * @property {number} index - Device index
 * @property {string} name - Device name
 * @property {string} hostApi - Host API name (ASIO)
 * @property {number} maxInputChannels - Maximum input channels
 * @property {number} maxOutputChannels - Maximum output channels
 * @property {number} defaultSampleRate - Default sample rate
 * @property {number} defaultLowInputLatency - Default low input latency (ms)
 * @property {number} defaultLowOutputLatency - Default low output latency (ms)
 * @property {number[]} supportedSampleRates - List of supported sample rates
 */

/**
 * @typedef {Object} StreamConfig
 * @property {number|string} [device] - Device index or name
 * @property {number} [deviceIndex] - Device index (alternative to device)
 * @property {number} [sampleRate=48000] - Sample rate in Hz
 * @property {number} [bufferSize=256] - Buffer size in frames
 * @property {number[]} [inputChannels] - Input channel indices (0-based)
 * @property {number[]} [outputChannels] - Output channel indices (0-based)
 */

/**
 * @typedef {Object} StreamStats
 * @property {number} callbackCount - Number of audio callbacks processed
 * @property {number} inputUnderflows - Number of input underflows
 * @property {number} outputUnderflows - Number of output underflows
 * @property {number} cpuLoad - CPU load (0.0 - 1.0)
 */
