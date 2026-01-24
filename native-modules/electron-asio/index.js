/**
 * Electron ASIO Audio Capture Module
 * Provides low-latency ASIO audio capture for professional audio interfaces
 * Windows only - requires ASIO drivers (ASIO4ALL, manufacturer drivers, etc.)
 */

'use strict';

const path = require('path');
const EventEmitter = require('events');

let nativeModule = null;
let isInitialized = false;

/**
 * Load the native ASIO module
 */
function loadNativeModule() {
    if (nativeModule) return nativeModule;

    try {
        // Try loading from build/Release (development)
        const modulePath = path.join(__dirname, 'build', 'Release', 'electron_asio.node');
        nativeModule = require(modulePath);
        return nativeModule;
    } catch (err) {
        console.warn('[electron-asio] Failed to load native module:', err.message);
        return null;
    }
}

/**
 * Initialize the ASIO subsystem
 * Must be called before any other ASIO functions
 */
function initialize() {
    if (isInitialized) return true;

    const mod = loadNativeModule();
    if (!mod) return false;

    try {
        mod.initialize();
        isInitialized = true;
        return true;
    } catch (err) {
        console.error('[electron-asio] Initialization failed:', err.message);
        return false;
    }
}

/**
 * Terminate the ASIO subsystem
 * Should be called when done using ASIO
 */
function terminate() {
    if (!isInitialized) return;

    const mod = loadNativeModule();
    if (mod) {
        try {
            mod.terminate();
        } catch (err) {
            console.warn('[electron-asio] Termination error:', err.message);
        }
    }
    isInitialized = false;
}

/**
 * Check if ASIO is available on this system
 * @returns {boolean} True if ASIO drivers are available
 */
function isAvailable() {
    const mod = loadNativeModule();
    if (!mod) return false;

    if (!isInitialized) {
        initialize();
    }

    try {
        return mod.isAvailable();
    } catch (err) {
        return false;
    }
}

/**
 * Get version information about the ASIO subsystem
 * @returns {string} Version string
 */
function getVersionInfo() {
    const mod = loadNativeModule();
    if (!mod) return 'ASIO module not available';

    if (!isInitialized) {
        initialize();
    }

    try {
        return mod.getVersionInfo();
    } catch (err) {
        return 'Unknown version';
    }
}

/**
 * Get list of available ASIO devices
 * @returns {Array} Array of device info objects
 */
function getDevices() {
    const mod = loadNativeModule();
    if (!mod) return [];

    if (!isInitialized) {
        initialize();
    }

    try {
        return mod.getDevices();
    } catch (err) {
        console.error('[electron-asio] Failed to get devices:', err.message);
        return [];
    }
}

/**
 * Get detailed info for a specific device
 * @param {number} deviceIndex - Device index
 * @returns {Object|null} Device info or null
 */
function getDeviceInfo(deviceIndex) {
    const mod = loadNativeModule();
    if (!mod) return null;

    if (!isInitialized) {
        initialize();
    }

    try {
        return mod.getDeviceInfo(deviceIndex);
    } catch (err) {
        console.error('[electron-asio] Failed to get device info:', err.message);
        return null;
    }
}

/**
 * ASIO Audio Stream class
 * Captures audio from an ASIO device and emits data events
 */
class AsioStream extends EventEmitter {
    constructor(options = {}) {
        super();

        this._deviceIndex = options.deviceIndex !== undefined ? options.deviceIndex : -1;
        this._sampleRate = options.sampleRate || 48000;
        this._channels = options.channels || 2;
        this._framesPerBuffer = options.framesPerBuffer || 256;
        this._stream = null;
        this._isRunning = false;
    }

    /**
     * Start the audio stream
     * @returns {boolean} True if started successfully
     */
    start() {
        if (this._isRunning) return true;

        const mod = loadNativeModule();
        if (!mod) {
            this.emit('error', new Error('ASIO module not available'));
            return false;
        }

        if (!isInitialized) {
            initialize();
        }

        try {
            this._stream = mod.createStream({
                deviceIndex: this._deviceIndex,
                sampleRate: this._sampleRate,
                channels: this._channels,
                framesPerBuffer: this._framesPerBuffer,
                callback: (audioData) => {
                    this.emit('data', audioData);
                }
            });

            if (this._stream && this._stream.start) {
                this._stream.start();
            }

            this._isRunning = true;
            this.emit('start');
            return true;
        } catch (err) {
            this.emit('error', err);
            return false;
        }
    }

    /**
     * Stop the audio stream
     */
    stop() {
        if (!this._isRunning) return;

        try {
            if (this._stream) {
                if (this._stream.stop) {
                    this._stream.stop();
                }
                if (this._stream.close) {
                    this._stream.close();
                }
                this._stream = null;
            }
        } catch (err) {
            console.warn('[electron-asio] Error stopping stream:', err.message);
        }

        this._isRunning = false;
        this.emit('stop');
    }

    /**
     * Check if stream is running
     * @returns {boolean}
     */
    get isRunning() {
        return this._isRunning;
    }

    /**
     * Get stream configuration
     * @returns {Object}
     */
    get config() {
        return {
            deviceIndex: this._deviceIndex,
            sampleRate: this._sampleRate,
            channels: this._channels,
            framesPerBuffer: this._framesPerBuffer
        };
    }
}

// Clean up on process exit
process.on('exit', () => {
    terminate();
});

module.exports = {
    initialize,
    terminate,
    isAvailable,
    getVersionInfo,
    getDevices,
    getDeviceInfo,
    AsioStream
};
