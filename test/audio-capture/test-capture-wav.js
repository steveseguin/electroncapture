const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// Load the window-audio-capture module
const audioCapture = require('../../native-modules/window-audio-capture');

// Constants
const TARGET_FREQUENCY = 440; // Hz
const FREQUENCY_TOLERANCE = 10; // Hz
const CAPTURE_DURATION = 4000; // ms
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
 * Launch Windows Media Player with the test tone
 */
function playTestTone() {
    return new Promise((resolve, reject) => {
        const wavPath = path.join(__dirname, 'test-tone-440hz.wav');
        
        if (!fs.existsSync(wavPath)) {
            reject(new Error('Test tone WAV file not found. Run: node generate-test-tone.js'));
            return;
        }
        
        console.log('Playing test tone via Windows Media Player...');
        
        // Use Windows Media Player to play the WAV file
        const wmplayer = spawn('cmd.exe', ['/c', 'start', '/min', 'wmplayer.exe', wavPath], {
            stdio: 'ignore',
            detached: true
        });
        
        wmplayer.unref();
        
        // Give WMP time to start and begin playing
        setTimeout(resolve, 2000);
    });
}

/**
 * Try to capture audio from Windows Media Player
 */
async function captureFromWMP() {
    const capturedData = [];
    let captureInfo = null;
    
    // Get audio sessions to find Windows Media Player
    const sessions = await audioCapture.getAudioSessions();
    console.log(`Found ${sessions.length} audio sessions`);
    
    // Look for Windows Media Player session
    let wmpSession = sessions.find(s => {
        // Session name might not be available, so check for any active session
        return s.isActive || s.processId;
    });
    
    if (!wmpSession && sessions.length > 0) {
        // If we can't identify WMP specifically, use the first active session
        wmpSession = sessions.find(s => s.isActive) || sessions[0];
    }
    
    if (!wmpSession) {
        throw new Error('No audio sessions found');
    }
    
    console.log(`Using audio session: Process ${wmpSession.processId}`);
    
    // Try streaming capture first
    try {
        const captureResult = await audioCapture.startStreamCapture(
            wmpSession.processId,
            (audioData) => {
                if (audioData && audioData.length > 0) {
                    if (audioData.buffer instanceof ArrayBuffer) {
                        capturedData.push(...audioData);
                    } else if (Array.isArray(audioData)) {
                        capturedData.push(...audioData);
                    } else if (typeof audioData === 'object') {
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
                method: 'streaming' 
            };
        }
    } catch (error) {
        console.log(`Streaming capture failed: ${error.message}`);
    }
    
    // Fallback to polling capture
    console.log('Trying polling capture...');
    
    const captureResult = await audioCapture.startCapture(wmpSession.processId);
    
    if (captureResult.success) {
        // Poll for audio data
        const pollInterval = setInterval(() => {
            const data = audioCapture.getAudioData();
            if (data && data.length > 0) {
                capturedData.push(...data);
            }
        }, 100);
        
        captureResult.pollInterval = pollInterval;
        
        return { 
            success: true, 
            captureResult, 
            capturedData,
            method: 'polling' 
        };
    }
    
    throw new Error('All capture methods failed');
}

/**
 * Main test function
 */
async function runTest() {
    console.log('=== Window Audio Capture Test (WAV Playback) ===\n');
    
    try {
        // Step 1: Play the test tone
        console.log('1. Playing test tone WAV file...');
        await playTestTone();
        
        // Step 2: Wait a moment for audio to stabilize
        console.log('\n2. Waiting for audio playback to stabilize...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Step 3: Start audio capture
        console.log('\n3. Starting audio capture...');
        const captureAttempt = await captureFromWMP();
        
        if (!captureAttempt.success) {
            throw new Error(`Failed to start capture`);
        }
        
        console.log(`Capture started successfully using method: ${captureAttempt.method}`);
        console.log(`Sample rate: ${captureAttempt.captureResult.sampleRate || 48000}`);
        console.log(`Channels: ${captureAttempt.captureResult.channels || 2}`);
        
        // Step 4: Capture audio
        console.log(`\n4. Capturing audio for ${CAPTURE_DURATION}ms...`);
        await new Promise(resolve => setTimeout(resolve, CAPTURE_DURATION));
        
        // Step 5: Stop capture
        console.log('\n5. Stopping capture...');
        if (captureAttempt.captureResult.pollInterval) {
            clearInterval(captureAttempt.captureResult.pollInterval);
        }
        await audioCapture.stopCapture();
        
        // Kill Windows Media Player
        exec('taskkill /F /IM wmplayer.exe', (err) => {
            // Ignore errors
        });
        
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
        
        // Save captured audio
        const outputPath = path.join(__dirname, 'captured-audio.raw');
        const buffer = Buffer.from(audioArray.buffer);
        fs.writeFileSync(outputPath, buffer);
        console.log(`\nCaptured audio saved to: ${outputPath}`);
        
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
        
        // Try to cleanup WMP
        exec('taskkill /F /IM wmplayer.exe', () => {});
        
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
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
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

// Check if running as admin
exec('net session', (error) => {
    if (error) {
        console.log('\n⚠️  WARNING: Not running as administrator');
        console.log('Audio capture may fail without admin privileges.');
        console.log('Run this test as administrator for best results.\n');
    }
    
    // Run the test
    runTest();
});