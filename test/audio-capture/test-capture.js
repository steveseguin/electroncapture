const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// Load the window-audio-capture module
const audioCapture = require('../../native-modules/window-audio-capture');

// Constants
const TARGET_FREQUENCY = 440; // Hz
const FREQUENCY_TOLERANCE = 5; // Hz
const CAPTURE_DURATION = 3000; // ms
const SAMPLE_ANALYSIS_SIZE = 8192; // samples for FFT

/**
 * Perform FFT to find dominant frequency
 */
function findDominantFrequency(samples, sampleRate) {
    // Simple peak detection using zero-crossing rate
    // For a more accurate result, we'd use a proper FFT library
    let zeroCrossings = 0;
    let previousSample = 0;
    
    for (let i = 1; i < samples.length; i++) {
        if ((previousSample < 0 && samples[i] >= 0) || 
            (previousSample >= 0 && samples[i] < 0)) {
            zeroCrossings++;
        }
        previousSample = samples[i];
    }
    
    // Calculate frequency from zero-crossing rate
    const duration = samples.length / sampleRate;
    const frequency = (zeroCrossings / 2) / duration;
    
    return frequency;
}

/**
 * Analyze audio data to check if it contains the expected tone
 */
function analyzeAudioData(audioData, sampleRate) {
    if (!audioData || audioData.length === 0) {
        return { success: false, error: 'No audio data captured' };
    }
    
    // Take a sample from the middle of the recording
    const startIdx = Math.floor(audioData.length / 4);
    const endIdx = startIdx + SAMPLE_ANALYSIS_SIZE;
    const sample = audioData.slice(startIdx, Math.min(endIdx, audioData.length));
    
    // Find dominant frequency
    const dominantFreq = findDominantFrequency(sample, sampleRate);
    
    // Check if it's within tolerance
    const isCorrect = Math.abs(dominantFreq - TARGET_FREQUENCY) <= FREQUENCY_TOLERANCE;
    
    // Calculate RMS for volume check
    let sumSquares = 0;
    for (let i = 0; i < sample.length; i++) {
        sumSquares += sample[i] * sample[i];
    }
    const rms = Math.sqrt(sumSquares / sample.length);
    
    return {
        success: isCorrect,
        dominantFrequency: dominantFreq,
        expectedFrequency: TARGET_FREQUENCY,
        rmsLevel: rms,
        hasAudio: rms > 0.01, // Check if there's actual audio
        sampleRate: sampleRate,
        samplesAnalyzed: sample.length
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
                // Give the browser time to open
                setTimeout(resolve, 3000);
            }
        });
    });
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
        
        // Step 2: Get list of windows
        console.log('\n2. Getting window list...');
        const windows = await audioCapture.getWindowList();
        console.log(`Found ${windows.length} windows`);
        
        // Find browser window (look for Chrome, Edge, or Firefox)
        const browserWindow = windows.find(w => {
            const exe = w.executableName.toLowerCase();
            return exe.includes('chrome.exe') || 
                   exe.includes('msedge.exe') || 
                   exe.includes('firefox.exe');
        });
        
        if (!browserWindow) {
            throw new Error('Could not find browser window. Please open the tone generator manually.');
        }
        
        console.log(`Found browser: ${browserWindow.executableName} - "${browserWindow.title}"`);
        console.log(`Process ID: ${browserWindow.processId}`);
        
        // Step 3: Start audio capture
        console.log('\n3. Starting audio capture...');
        const capturedData = [];
        let captureInfo = null;
        
        const captureResult = await audioCapture.startStreamCapture(
            browserWindow.processId,
            (audioInfo) => {
                if (!captureInfo) {
                    captureInfo = {
                        sampleRate: audioInfo.sampleRate || 48000,
                        channels: audioInfo.channels || 2
                    };
                }
                // Store the audio data
                if (audioInfo.samples) {
                    capturedData.push(...audioInfo.samples);
                } else if (audioInfo.data) {
                    capturedData.push(...audioInfo.data);
                } else if (audioInfo) {
                    capturedData.push(...audioInfo);
                }
            }
        );
        
        if (!captureResult.success) {
            throw new Error(`Failed to start capture: ${captureResult.error}`);
        }
        
        console.log(`Capture started successfully`);
        console.log(`Sample rate: ${captureResult.sampleRate || captureInfo?.sampleRate || 48000}`);
        console.log(`Channels: ${captureResult.channels || captureInfo?.channels || 2}`);
        
        // Step 4: Wait for capture duration
        console.log(`\n4. Capturing audio for ${CAPTURE_DURATION}ms...`);
        await new Promise(resolve => setTimeout(resolve, CAPTURE_DURATION));
        
        // Step 5: Stop capture
        console.log('\n5. Stopping capture...');
        await audioCapture.stopCapture();
        
        // Step 6: Analyze captured audio
        console.log('\n6. Analyzing captured audio...');
        console.log(`Total samples captured: ${capturedData.length}`);
        
        const audioArray = new Float32Array(capturedData);
        const analysis = analyzeAudioData(
            audioArray, 
            captureResult.sampleRate || captureInfo?.sampleRate || 48000
        );
        
        // Step 7: Report results
        console.log('\n=== Test Results ===');
        console.log(`Audio captured: ${analysis.hasAudio ? 'YES' : 'NO'}`);
        console.log(`RMS Level: ${analysis.rmsLevel.toFixed(4)}`);
        console.log(`Dominant frequency: ${analysis.dominantFrequency.toFixed(1)} Hz`);
        console.log(`Expected frequency: ${analysis.expectedFrequency} Hz`);
        console.log(`Frequency match: ${analysis.success ? 'PASS' : 'FAIL'}`);
        
        // Save captured audio to file for debugging
        const outputPath = path.join(__dirname, 'captured-audio.raw');
        const buffer = Buffer.from(audioArray.buffer);
        fs.writeFileSync(outputPath, buffer);
        console.log(`\nCaptured audio saved to: ${outputPath}`);
        console.log(`(Raw PCM, ${captureResult.sampleRate || 48000}Hz, float32)`);
        
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
        process.exit(1);
    }
}

// Run the test
runTest();