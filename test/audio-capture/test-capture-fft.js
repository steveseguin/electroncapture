const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// Load the window-audio-capture module
const audioCapture = require('../../native-modules/window-audio-capture');

// Constants
const TARGET_FREQUENCY = 440; // Hz
const FREQUENCY_TOLERANCE = 10; // Hz
const CAPTURE_DURATION = 4000; // ms (give more time for stable capture)
const FFT_SIZE = 8192; // samples for FFT

/**
 * Simple DFT implementation for frequency analysis
 */
function computeDFT(samples, sampleRate) {
    const N = samples.length;
    const frequencies = [];
    const magnitudes = [];
    
    // We only need to check up to Nyquist frequency
    const maxFreq = sampleRate / 2;
    const freqResolution = sampleRate / N;
    
    // Focus on frequencies around our target (400-480 Hz)
    const startBin = Math.floor(400 / freqResolution);
    const endBin = Math.ceil(480 / freqResolution);
    
    for (let k = startBin; k <= endBin; k++) {
        let real = 0;
        let imag = 0;
        
        for (let n = 0; n < N; n++) {
            const angle = -2 * Math.PI * k * n / N;
            real += samples[n] * Math.cos(angle);
            imag += samples[n] * Math.sin(angle);
        }
        
        const magnitude = Math.sqrt(real * real + imag * imag) / N;
        const frequency = k * freqResolution;
        
        frequencies.push(frequency);
        magnitudes.push(magnitude);
    }
    
    // Find peak frequency
    let maxMagnitude = 0;
    let peakFrequency = 0;
    
    for (let i = 0; i < magnitudes.length; i++) {
        if (magnitudes[i] > maxMagnitude) {
            maxMagnitude = magnitudes[i];
            peakFrequency = frequencies[i];
        }
    }
    
    return { peakFrequency, maxMagnitude };
}

/**
 * Analyze audio data to check if it contains the expected tone
 */
function analyzeAudioData(audioData, sampleRate) {
    if (!audioData || audioData.length === 0) {
        return { success: false, error: 'No audio data captured' };
    }
    
    // Calculate RMS for volume check
    let sumSquares = 0;
    for (let i = 0; i < audioData.length; i++) {
        sumSquares += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sumSquares / audioData.length);
    
    // Take multiple samples throughout the recording
    const results = [];
    const sampleSize = Math.min(FFT_SIZE, Math.floor(audioData.length / 4));
    
    for (let offset = sampleSize; offset < audioData.length - sampleSize; offset += sampleSize) {
        const sample = audioData.slice(offset, offset + sampleSize);
        const { peakFrequency, maxMagnitude } = computeDFT(sample, sampleRate);
        
        if (maxMagnitude > 0.01) { // Only consider samples with sufficient volume
            results.push(peakFrequency);
        }
    }
    
    // Calculate median frequency
    results.sort((a, b) => a - b);
    const medianFreq = results.length > 0 ? results[Math.floor(results.length / 2)] : 0;
    
    // Check if it's within tolerance
    const isCorrect = Math.abs(medianFreq - TARGET_FREQUENCY) <= FREQUENCY_TOLERANCE;
    
    return {
        success: isCorrect,
        dominantFrequency: medianFreq,
        expectedFrequency: TARGET_FREQUENCY,
        rmsLevel: rms,
        hasAudio: rms > 0.01,
        sampleRate: sampleRate,
        samplesAnalyzed: audioData.length,
        frequencyMeasurements: results.length
    };
}

/**
 * Launch the tone generator in a browser
 */
function launchToneGenerator() {
    return new Promise((resolve, reject) => {
        const htmlPath = path.join(__dirname, 'tone-generator.html');
        const windowsPath = htmlPath.replace(/\//g, '\\');
        
        console.log('Launching tone generator at:', windowsPath);
        
        // Use cmd.exe to open the HTML file in the default browser
        exec(`cmd.exe /c start "" "${windowsPath}"`, (error) => {
            if (error) {
                reject(error);
            } else {
                // Give the browser time to open and start playing
                setTimeout(resolve, 4000);
            }
        });
    });
}

/**
 * Try to capture using different methods
 */
async function attemptCapture(windowInfo) {
    const capturedData = [];
    let captureInfo = null;
    
    // Method 1: Try with process ID
    console.log(`Attempting capture with process ID: ${windowInfo.processId}`);
    
    try {
        const captureResult = await audioCapture.startStreamCapture(
            windowInfo.processId,
            (audioData) => {
                // Handle different data formats
                if (audioData && audioData.length > 0) {
                    if (audioData.buffer instanceof ArrayBuffer) {
                        // It's a typed array
                        capturedData.push(...audioData);
                    } else if (Array.isArray(audioData)) {
                        // It's a regular array
                        capturedData.push(...audioData);
                    } else if (typeof audioData === 'object') {
                        // It might be wrapped in an object
                        if (audioData.samples) {
                            capturedData.push(...audioData.samples);
                        } else if (audioData.data) {
                            capturedData.push(...audioData.data);
                        }
                    }
                }
            }
        );
        
        if (captureResult.success) {
            return { 
                success: true, 
                captureResult, 
                capturedData,
                method: 'processId' 
            };
        }
    } catch (error) {
        console.log(`Process ID capture failed: ${error.message}`);
    }
    
    // Method 2: Try with window handle/ID
    if (windowInfo.id && windowInfo.id !== windowInfo.processId) {
        console.log(`Attempting capture with window ID: ${windowInfo.id}`);
        
        try {
            const captureResult = await audioCapture.startStreamCapture(
                windowInfo.id,
                (audioData) => {
                    if (audioData && audioData.length > 0) {
                        capturedData.push(...audioData);
                    }
                }
            );
            
            if (captureResult.success) {
                return { 
                    success: true, 
                    captureResult, 
                    capturedData,
                    method: 'windowId' 
                };
            }
        } catch (error) {
            console.log(`Window ID capture failed: ${error.message}`);
        }
    }
    
    // Method 3: Try using audio sessions
    console.log('Attempting capture via audio sessions...');
    
    try {
        const sessions = await audioCapture.getAudioSessions();
        const activeSession = sessions.find(s => s.processId === windowInfo.processId);
        
        if (activeSession) {
            console.log(`Found audio session for process ${windowInfo.processId}`);
            
            const captureResult = await audioCapture.startCapture(activeSession.processId);
            
            if (captureResult.success) {
                // For non-streaming capture, we need to poll
                const pollInterval = setInterval(() => {
                    const data = audioCapture.getAudioData();
                    if (data && data.length > 0) {
                        capturedData.push(...data);
                    }
                }, 100);
                
                // Store interval for cleanup
                captureResult.pollInterval = pollInterval;
                
                return { 
                    success: true, 
                    captureResult, 
                    capturedData,
                    method: 'audioSession' 
                };
            }
        }
    } catch (error) {
        console.log(`Audio session capture failed: ${error.message}`);
    }
    
    return { success: false, error: 'All capture methods failed' };
}

/**
 * Main test function
 */
async function runTest() {
    console.log('=== Window Audio Capture Test ===\n');
    
    try {
        // Step 1: Launch tone generator
        console.log('1. Launching tone generator...');
        await launchToneGenerator();
        
        // Step 2: Get list of windows and audio sessions
        console.log('\n2. Getting window list and audio sessions...');
        const windows = await audioCapture.getWindowList();
        const sessions = await audioCapture.getAudioSessions();
        
        console.log(`Found ${windows.length} windows`);
        console.log(`Found ${sessions.length} audio sessions`);
        
        // List audio sessions for debugging
        if (sessions.length > 0) {
            console.log('\nActive audio sessions:');
            sessions.forEach(s => {
                console.log(`  - Process ${s.processId}: ${s.sessionName || 'Unknown'}`);
            });
        }
        
        // Find browser window
        const browserWindow = windows.find(w => {
            const exe = w.executableName.toLowerCase();
            return exe.includes('chrome.exe') || 
                   exe.includes('msedge.exe') || 
                   exe.includes('firefox.exe');
        });
        
        if (!browserWindow) {
            throw new Error('Could not find browser window. Please open the tone generator manually.');
        }
        
        console.log(`\nFound browser: ${browserWindow.executableName}`);
        console.log(`Window title: "${browserWindow.title}"`);
        console.log(`Process ID: ${browserWindow.processId}`);
        console.log(`Window ID: ${browserWindow.id}`);
        
        // Step 3: Start audio capture
        console.log('\n3. Starting audio capture...');
        const captureAttempt = await attemptCapture(browserWindow);
        
        if (!captureAttempt.success) {
            throw new Error(`Failed to start capture: ${captureAttempt.error}`);
        }
        
        console.log(`Capture started successfully using method: ${captureAttempt.method}`);
        console.log(`Sample rate: ${captureAttempt.captureResult.sampleRate || 48000}`);
        console.log(`Channels: ${captureAttempt.captureResult.channels || 2}`);
        
        // Step 4: Wait for capture duration
        console.log(`\n4. Capturing audio for ${CAPTURE_DURATION}ms...`);
        await new Promise(resolve => setTimeout(resolve, CAPTURE_DURATION));
        
        // Step 5: Stop capture
        console.log('\n5. Stopping capture...');
        if (captureAttempt.captureResult.pollInterval) {
            clearInterval(captureAttempt.captureResult.pollInterval);
        }
        await audioCapture.stopCapture();
        
        // Step 6: Analyze captured audio
        console.log('\n6. Analyzing captured audio...');
        console.log(`Total samples captured: ${captureAttempt.capturedData.length}`);
        
        if (captureAttempt.capturedData.length === 0) {
            throw new Error('No audio data was captured');
        }
        
        const audioArray = new Float32Array(captureAttempt.capturedData);
        const analysis = analyzeAudioData(
            audioArray, 
            captureAttempt.captureResult.sampleRate || 48000
        );
        
        // Step 7: Report results
        console.log('\n=== Test Results ===');
        console.log(`Audio captured: ${analysis.hasAudio ? 'YES' : 'NO'}`);
        console.log(`RMS Level: ${analysis.rmsLevel.toFixed(4)}`);
        console.log(`Dominant frequency: ${analysis.dominantFrequency.toFixed(1)} Hz`);
        console.log(`Expected frequency: ${analysis.expectedFrequency} Hz`);
        console.log(`Frequency error: ${Math.abs(analysis.dominantFrequency - analysis.expectedFrequency).toFixed(1)} Hz`);
        console.log(`Frequency measurements: ${analysis.frequencyMeasurements}`);
        console.log(`Frequency match: ${analysis.success ? 'PASS' : 'FAIL'}`);
        
        // Save captured audio to file for debugging
        const outputPath = path.join(__dirname, 'captured-audio.raw');
        const buffer = Buffer.from(audioArray.buffer);
        fs.writeFileSync(outputPath, buffer);
        console.log(`\nCaptured audio saved to: ${outputPath}`);
        console.log(`(Raw PCM, ${captureAttempt.captureResult.sampleRate || 48000}Hz, float32)`);
        
        // Create a WAV file for easier playback
        const wavPath = path.join(__dirname, 'captured-audio.wav');
        createWavFile(audioArray, captureAttempt.captureResult.sampleRate || 48000, wavPath);
        console.log(`WAV file saved to: ${wavPath}`);
        
        // Overall test result
        if (analysis.hasAudio && analysis.success) {
            console.log('\n✅ TEST PASSED: Successfully captured 440Hz tone');
            process.exit(0);
        } else if (!analysis.hasAudio) {
            console.log('\n❌ TEST FAILED: No audio was captured');
            process.exit(1);
        } else {
            console.log('\n❌ TEST FAILED: Captured audio does not match expected frequency');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('\n❌ TEST ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

/**
 * Create a WAV file from float32 samples
 */
function createWavFile(samples, sampleRate, outputPath) {
    const length = samples.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, 'data');
    view.setUint32(40, length * 2, true);
    
    // Convert float32 to int16
    let offset = 44;
    for (let i = 0; i < length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, sample * 0x7FFF, true);
        offset += 2;
    }
    
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
}

// Run the test
runTest();