// WindowAudioStream class to bridge VDO.Ninja with the native window audio capture module
console.log('WindowAudioStream: Loading WindowAudioStream class');

class WindowAudioStream {
    constructor() {
        this.audioContext = null;
        this.captureActive = false;
        this.audioStream = null;
        this.scriptProcessor = null;
        this.bufferSize = 4096;
        this.sampleRate = 48000;
        this.channels = 2;
        this.cleanupCallback = null;
        this.currentProcessId = null;
        this.currentRequestTarget = null;
        this.usingProcessLoopback = false;
    }

    _prepareTarget(targetId) {
        if (typeof targetId === 'number' && Number.isFinite(targetId) && targetId > 0) {
            return {
                requestTarget: targetId,
                clientId: String(targetId)
            };
        }

        if (typeof targetId === 'bigint' && targetId > 0n) {
            const numericValue = Number(targetId);
            if (!Number.isFinite(numericValue) || numericValue <= 0) {
                throw new Error(`WindowAudioStream: Invalid process identifier: ${targetId}`);
            }
            return {
                requestTarget: numericValue,
                clientId: targetId.toString()
            };
        }

        if (typeof targetId === 'string') {
            const trimmed = targetId.trim();
            if (!trimmed.length) {
                throw new Error('WindowAudioStream: Invalid process identifier: empty string');
            }
            if (/^\d+$/.test(trimmed)) {
                const numericValue = Number(trimmed);
                if (!Number.isFinite(numericValue) || numericValue <= 0) {
                    throw new Error(`WindowAudioStream: Invalid process identifier: ${targetId}`);
                }
                return {
                    requestTarget: numericValue,
                    clientId: trimmed
                };
            }
            return {
                requestTarget: trimmed,
                clientId: trimmed
            };
        }

        throw new Error(`WindowAudioStream: Invalid process identifier: ${targetId}`);
    }

    async start(targetId) {
        console.log(`WindowAudioStream: Starting capture for target ${targetId} (type: ${typeof targetId})`);

        const targetInfo = this._prepareTarget(targetId);
        const { requestTarget, clientId } = targetInfo;

        console.log(`WindowAudioStream: Normalized target ${targetId} -> ${clientId}`);

        if (this.captureActive) {
            await this.stop();
        }

        this.currentProcessId = clientId;
        this.currentRequestTarget = requestTarget;
        this.usingProcessLoopback = false;

        try {
            if (!this.audioContext || this.audioContext.state === 'closed') {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: this.sampleRate,
                    latencyHint: 'interactive'
                });
            }

            const result = await window.electronApi.startStreamCapture(requestTarget);
            if (!result || result.success !== true) {
                throw new Error(result && result.error ? result.error : 'Failed to start window audio capture');
            }

            console.log(`WindowAudioStream: Native capture started - Sample rate: ${result.sampleRate}, Channels: ${result.channels}`);

            this.sampleRate = result.sampleRate || 48000;
            this.channels = result.channels || 2;
            this.usingProcessLoopback = !!result.usingProcessSpecificLoopback;

            const destination = this.audioContext.createMediaStreamDestination();
            this.scriptProcessor = this.audioContext.createScriptProcessor(this.bufferSize, this.channels, this.channels);

            let sampleBuffer = [];
            let lastProcessTime = performance.now();

            this.cleanupCallback = window.electronApi.onAudioStreamData((payload) => {
                if (!payload || (payload.clientId && payload.clientId !== this.currentProcessId)) {
                    return;
                }

                const data = payload.data || payload;
                if (!data || !data.samples) {
                    console.warn('WindowAudioStream: Received invalid audio data');
                    return;
                }

                const samples = data.samples;
                const sampleRate = data.sampleRate || this.sampleRate;
                const channels = data.channels || this.channels;

                // Normalise channel count if backend sends unexpected layout
                if (channels !== this.channels) {
                    this.channels = channels;
                }
                if (sampleRate && sampleRate !== this.sampleRate) {
                    this.sampleRate = sampleRate;
                }

                sampleBuffer.push(...samples);

                const now = performance.now();
                if (now - lastProcessTime > 5000) {
                    console.log(`WindowAudioStream: Buffer health - ${sampleBuffer.length} samples buffered`);
                    lastProcessTime = now;
                }
            });

            this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                const outputBuffer = audioProcessingEvent.outputBuffer;
                const numChannels = outputBuffer.numberOfChannels;
                const frameCount = outputBuffer.length;
                const samplesNeeded = frameCount * numChannels;

                if (sampleBuffer.length >= samplesNeeded) {
                    const frameSamples = sampleBuffer.splice(0, samplesNeeded);
                    for (let channel = 0; channel < numChannels; channel++) {
                        const outputData = outputBuffer.getChannelData(channel);
                        for (let i = 0; i < frameCount; i++) {
                            outputData[i] = frameSamples[i * numChannels + channel] || 0;
                        }
                    }
                } else {
                    for (let channel = 0; channel < numChannels; channel++) {
                        const outputData = outputBuffer.getChannelData(channel);
                        outputData.fill(0);
                    }
                }
            };

            this.scriptProcessor.connect(destination);

            this.audioStream = destination.stream;
            this.captureActive = true;

            console.log('WindowAudioStream: Audio stream created successfully');
            return this.audioStream;
        } catch (error) {
            console.error('WindowAudioStream: Error starting capture:', error);
            this.captureActive = false;
            this.currentProcessId = null;
            this.currentRequestTarget = null;
            throw error;
        }
    }

    async stop() {
        if (!this.captureActive && !this.currentProcessId && !this.audioStream) {
            return;
        }

        console.log('WindowAudioStream: Stopping capture');

        try {
            if (window.electronApi && typeof window.electronApi.stopStreamCapture === 'function' && (this.currentRequestTarget || this.currentProcessId)) {
                const target = this.currentRequestTarget != null ? this.currentRequestTarget : this.currentProcessId;
                await window.electronApi.stopStreamCapture(target);
            }
        } catch (error) {
            console.warn('WindowAudioStream: stopStreamCapture threw', error);
        }

        try {
            if (this.cleanupCallback) {
                this.cleanupCallback();
                this.cleanupCallback = null;
            }
        } catch (error) {
            console.warn('WindowAudioStream: cleanup callback threw', error);
        }

        try {
            if (this.scriptProcessor) {
                this.scriptProcessor.disconnect();
                this.scriptProcessor.onaudioprocess = null;
                this.scriptProcessor = null;
            }
        } catch (error) {
            console.warn('WindowAudioStream: Error disconnecting scriptProcessor', error);
        }

        try {
            if (this.audioStream) {
                this.audioStream.getTracks().forEach((track) => {
                    try {
                        track.stop();
                    } catch (err) {
                        console.warn('WindowAudioStream: Failed to stop track', err);
                    }
                });
                this.audioStream = null;
            }
        } catch (error) {
            console.warn('WindowAudioStream: Error stopping tracks', error);
        }

        try {
            if (this.audioContext && this.audioContext.state !== 'closed') {
                await this.audioContext.close();
            }
        } catch (error) {
            console.warn('WindowAudioStream: Error closing AudioContext', error);
        }

        this.captureActive = false;
        this.currentProcessId = null;
        this.currentRequestTarget = null;
        this.usingProcessLoopback = false;

        console.log('WindowAudioStream: Capture stopped successfully');
    }

    isCapturing() {
        return this.captureActive;
    }

    getStream() {
        return this.audioStream;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = WindowAudioStream;
}

if (typeof window !== 'undefined') {
    window.WindowAudioStream = WindowAudioStream;
    console.log('WindowAudioStream: Class made available as window.WindowAudioStream');
}
