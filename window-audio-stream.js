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
    }

    async start(windowId) {
        console.log(`WindowAudioStream: Starting capture for window ID ${windowId} (type: ${typeof windowId})`);
        
        // Convert windowId if it's a string that looks like a number
        if (typeof windowId === 'string' && /^\d+$/.test(windowId)) {
            windowId = parseInt(windowId, 10);
            console.log(`WindowAudioStream: Converted windowId to number: ${windowId}`);
        }
        
        if (this.captureActive) {
            await this.stop();
        }

        try {
            // Create a new audio context if needed
            if (!this.audioContext || this.audioContext.state === 'closed') {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                    sampleRate: this.sampleRate,
                    latencyHint: 'interactive'
                });
            }

            // Start the native capture
            const result = await window.electronApi.startStreamCapture(windowId);
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to start window audio capture');
            }

            console.log(`WindowAudioStream: Native capture started - Sample rate: ${result.sampleRate}, Channels: ${result.channels}`);
            
            // Update our settings based on what the native module returned
            this.sampleRate = result.sampleRate || 48000;
            this.channels = result.channels || 2;
            
            // Create a destination stream
            const destination = this.audioContext.createMediaStreamDestination();
            
            // Create a script processor to handle the audio data
            this.scriptProcessor = this.audioContext.createScriptProcessor(this.bufferSize, this.channels, this.channels);
            
            // Buffer to accumulate samples
            let sampleBuffer = [];
            let lastProcessTime = performance.now();
            
            // Set up the stream data handler
            this.cleanupCallback = window.electronApi.onAudioStreamData((data) => {
                if (!data || !data.data || !data.data.samples) {
                    console.warn('WindowAudioStream: Received invalid audio data');
                    return;
                }

                const samples = data.data.samples;
                const sampleRate = data.data.sampleRate || this.sampleRate;
                const channels = data.data.channels || this.channels;

                // Add samples to buffer
                sampleBuffer.push(...samples);
                
                // Monitor performance
                const now = performance.now();
                if (now - lastProcessTime > 5000) {
                    console.log(`WindowAudioStream: Buffer health - ${sampleBuffer.length} samples buffered`);
                    lastProcessTime = now;
                }
            });

            // Process audio through script processor
            this.scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                const outputBuffer = audioProcessingEvent.outputBuffer;
                const numChannels = outputBuffer.numberOfChannels;
                const frameCount = outputBuffer.length;
                
                // Check if we have enough samples in the buffer
                const samplesNeeded = frameCount * numChannels;
                
                if (sampleBuffer.length >= samplesNeeded) {
                    // Extract samples for this frame
                    const frameSamples = sampleBuffer.splice(0, samplesNeeded);
                    
                    // De-interleave and copy to output channels
                    for (let channel = 0; channel < numChannels; channel++) {
                        const outputData = outputBuffer.getChannelData(channel);
                        for (let i = 0; i < frameCount; i++) {
                            outputData[i] = frameSamples[i * numChannels + channel] || 0;
                        }
                    }
                } else {
                    // Not enough samples, output silence
                    for (let channel = 0; channel < numChannels; channel++) {
                        const outputData = outputBuffer.getChannelData(channel);
                        outputData.fill(0);
                    }
                }
            };

            // Connect the processor to the destination
            this.scriptProcessor.connect(destination);
            
            // Store the stream
            this.audioStream = destination.stream;
            this.captureActive = true;

            console.log('WindowAudioStream: Audio stream created successfully');
            return this.audioStream;

        } catch (error) {
            console.error('WindowAudioStream: Error starting capture:', error);
            this.captureActive = false;
            throw error;
        }
    }

    async stop() {
        console.log('WindowAudioStream: Stopping capture');
        
        try {
            // Stop the native capture
            if (window.electronApi && window.electronApi.stopStreamCapture) {
                await window.electronApi.stopStreamCapture();
            }

            // Clean up the stream data handler
            if (this.cleanupCallback) {
                this.cleanupCallback();
                this.cleanupCallback = null;
            }

            // Disconnect and clean up audio nodes
            if (this.scriptProcessor) {
                this.scriptProcessor.disconnect();
                this.scriptProcessor.onaudioprocess = null;
                this.scriptProcessor = null;
            }

            // Stop all tracks in the stream
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(track => track.stop());
                this.audioStream = null;
            }

            // Close audio context if it's still open
            if (this.audioContext && this.audioContext.state !== 'closed') {
                await this.audioContext.close();
            }

            this.captureActive = false;

            console.log('WindowAudioStream: Capture stopped successfully');
        } catch (error) {
            console.error('WindowAudioStream: Error stopping capture:', error);
        }
    }

    // Get current capture state
    isCapturing() {
        return this.captureActive;
    }

    // Get the current audio stream
    getStream() {
        return this.audioStream;
    }
}

// Export for use in Electron renderer
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WindowAudioStream;
}

// Make available globally in the window
if (typeof window !== 'undefined') {
    window.WindowAudioStream = WindowAudioStream;
    console.log('WindowAudioStream: Class made available as window.WindowAudioStream');
}