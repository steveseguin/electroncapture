const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Try to load the native module directly
let audioCapture;
try {
    audioCapture = require('../../native-modules/window-audio-capture/build/Release/window_audio_capture.node');
    console.log('Loaded native module directly');
} catch (err) {
    console.log('Failed to load native module directly, trying wrapper...');
    audioCapture = require('../../native-modules/window-audio-capture');
}

// Constants
const TARGET_FREQUENCY = 440; // Hz
const FREQUENCY_TOLERANCE = 20; // Hz (more tolerance for default capture)
const CAPTURE_DURATION = 5000; // ms

/**
 * Simple frequency detection using zero-crossing
 */
function detectFrequency(samples, sampleRate) {
    if (!samples || samples.length < 1000) {
        return 0;
    }
    
    // Count zero crossings
    let crossings = 0;
    let lastSample = samples[0];
    
    for (let i = 1; i < samples.length; i++) {
        if ((lastSample < 0 && samples[i] >= 0) || (lastSample >= 0 && samples[i] < 0)) {
            crossings++;
        }
        lastSample = samples[i];
    }
    
    // Calculate frequency from zero crossings
    const duration = samples.length / sampleRate;
    const frequency = (crossings / 2) / duration;
    
    return frequency;
}

/**
 * Play the test tone
 */
function playTestTone() {
    return new Promise((resolve) => {
        const wavPath = path.join(__dirname, 'test-tone-440hz.wav');
        
        if (!fs.existsSync(wavPath)) {
            console.error('Test tone not found. Run: node generate-test-tone.js');
            process.exit(1);
        }
        
        console.log('Playing test tone...');
        
        // Use Windows sound player
        exec(`powershell -c "(New-Object Media.SoundPlayer '${wavPath}').PlaySync()"`, (error) => {
            if (error) {
                console.log('Failed to play with PowerShell, trying alternative...');
                // Try Windows Media Player as fallback
                exec(`start /min wmplayer.exe "${wavPath}"`, () => {
                    setTimeout(resolve, 1000);
                });
            } else {
                resolve();
            }
        });
    });
}

/**
 * Main test function
 */
async function runTest() {
    console.log('=== Simple Audio Capture Test ===\n');
    
    try {
        // Test 1: Check if we can get audio sessions
        console.log('1. Checking audio sessions...');
        
        if (audioCapture.WindowAudioCapture) {
            const capture = new audioCapture.WindowAudioCapture();
            const sessions = capture.getAudioSessions();
            console.log(`Found ${sessions.length} audio sessions`);
        } else {
            const sessions = await audioCapture.getAudioSessions();
            console.log(`Found ${sessions.length} audio sessions`);
        }
        
        // Test 2: Play tone and capture
        console.log('\n2. Playing and capturing test tone...');
        await playTestTone();
        
        // Give audio time to start
        await new Promise(resolve => setTimeout(resolve, 500));
        
        console.log('Starting capture...');
        
        // Try different capture methods
        let capturedData = [];
        let captureSuccess = false;
        
        // Method 1: Try capturing from any active audio session
        if (audioCapture.getAudioSessions) {
            const sessions = await audioCapture.getAudioSessions();
            const activeSession = sessions.find(s => s.isActive) || sessions[0];
            
            if (activeSession) {
                console.log(`Attempting capture from session: Process ${activeSession.processId}`);
                
                try {
                    const result = await audioCapture.startCapture(activeSession.processId);
                    if (result.success) {
                        captureSuccess = true;
                        console.log('Capture started successfully');
                        
                        // Poll for data
                        const pollInterval = setInterval(() => {
                            const data = audioCapture.getAudioData();
                            if (data && data.length > 0) {
                                capturedData.push(...data);
                            }
                        }, 100);
                        
                        // Capture for duration
                        await new Promise(resolve => setTimeout(resolve, CAPTURE_DURATION));
                        
                        clearInterval(pollInterval);
                        await audioCapture.stopCapture();
                    }
                } catch (err) {
                    console.log(`Session capture failed: ${err.message}`);
                }
            }
        }
        
        // Test 3: Analyze results
        console.log('\n3. Analyzing captured audio...');
        console.log(`Total samples captured: ${capturedData.length}`);
        
        if (capturedData.length === 0) {
            console.log('\n❌ TEST FAILED: No audio captured');
            console.log('\nPossible reasons:');
            console.log('- Need to run as administrator');
            console.log('- Audio device is muted');
            console.log('- Process-specific capture not supported for this audio source');
            process.exit(1);
        }
        
        // Analyze frequency
        const audioArray = new Float32Array(capturedData);
        const detectedFreq = detectFrequency(audioArray, 48000); // Assume 48kHz
        
        console.log(`\nDetected frequency: ${detectedFreq.toFixed(1)} Hz`);
        console.log(`Expected frequency: ${TARGET_FREQUENCY} Hz`);
        console.log(`Error: ${Math.abs(detectedFreq - TARGET_FREQUENCY).toFixed(1)} Hz`);
        
        // Calculate RMS
        let sum = 0;
        for (let i = 0; i < audioArray.length; i++) {
            sum += audioArray[i] * audioArray[i];
        }
        const rms = Math.sqrt(sum / audioArray.length);
        console.log(`RMS level: ${rms.toFixed(4)}`);
        
        // Save captured audio
        const outputPath = path.join(__dirname, 'captured-default.raw');
        fs.writeFileSync(outputPath, Buffer.from(audioArray.buffer));
        console.log(`\nCaptured audio saved to: ${outputPath}`);
        
        // Check results
        const frequencyMatch = Math.abs(detectedFreq - TARGET_FREQUENCY) <= FREQUENCY_TOLERANCE;
        const hasAudio = rms > 0.001;
        
        if (hasAudio && frequencyMatch) {
            console.log('\n✅ TEST PASSED');
        } else if (hasAudio) {
            console.log('\n⚠️  TEST PARTIAL: Audio captured but frequency mismatch');
        } else {
            console.log('\n❌ TEST FAILED: No meaningful audio captured');
        }
        
    } catch (error) {
        console.error('\n❌ TEST ERROR:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
    
    // Cleanup
    exec('taskkill /F /IM wmplayer.exe 2>nul', () => {});
}

// Check admin status
exec('net session', (error) => {
    if (error) {
        console.log('⚠️  Not running as administrator - capture may fail\n');
    } else {
        console.log('✓ Running with administrator privileges\n');
    }
    
    runTest();
});