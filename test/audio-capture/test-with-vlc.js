const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// Load the window-audio-capture module
const audioCapture = require('../../native-modules/window-audio-capture');

// Constants
const CAPTURE_DURATION = 5000; // ms

/**
 * Play WAV file using VLC or Windows Media Player
 */
function playWavFile() {
    return new Promise((resolve, reject) => {
        const wavPath = path.join(__dirname, 'test-tone-440hz.wav');
        
        if (!fs.existsSync(wavPath)) {
            reject(new Error('test-tone-440hz.wav not found. Run: node generate-test-tone.js'));
            return;
        }
        
        console.log('Attempting to play WAV file...');
        
        // Check if VLC is installed
        exec('where vlc', (error, stdout) => {
            if (!error && stdout.trim()) {
                // Use VLC
                console.log('Using VLC media player...');
                const vlc = spawn('vlc', [
                    '--intf', 'dummy',  // No interface
                    '--play-and-exit',  // Exit after playing
                    wavPath
                ], {
                    detached: true,
                    stdio: 'ignore'
                });
                vlc.unref();
                setTimeout(resolve, 2000);
            } else {
                // Try Windows Media Player as fallback
                console.log('VLC not found, using Windows Media Player...');
                exec(`start wmplayer "${wavPath}"`, (err) => {
                    if (err) {
                        // Last resort - use default program
                        console.log('Trying default audio player...');
                        exec(`start "" "${wavPath}"`, () => {
                            setTimeout(resolve, 2000);
                        });
                    } else {
                        setTimeout(resolve, 2000);
                    }
                });
            }
        });
    });
}

/**
 * Main test function
 */
async function runTest() {
    console.log('=== Audio Capture Test (Media Player) ===\n');
    
    try {
        // Step 1: Generate WAV if needed
        if (!fs.existsSync(path.join(__dirname, 'test-tone-440hz.wav'))) {
            console.log('Generating test tone...');
            require('./generate-test-tone.js');
        }
        
        // Step 2: Play the WAV file
        console.log('\n1. Playing test tone WAV file...');
        await playWavFile();
        
        // Step 3: Check audio sessions
        console.log('\n2. Checking audio sessions...');
        const sessions = await audioCapture.getAudioSessions();
        console.log(`Found ${sessions.length} audio sessions`);
        
        if (sessions.length > 0) {
            console.log('\nActive sessions:');
            sessions.forEach((s, i) => {
                console.log(`  ${i}: Process ${s.processId} - Active: ${s.isActive}`);
            });
        }
        
        // Step 4: Find media player
        console.log('\n3. Finding media player window...');
        const windows = await audioCapture.getWindowList();
        
        let targetWindow = windows.find(w => {
            const exe = w.executableName.toLowerCase();
            return exe.includes('vlc.exe') || 
                   exe.includes('wmplayer.exe') ||
                   exe.includes('mpc-hc') ||
                   exe.includes('movies') ||
                   (exe.includes('applicationframehost') && w.title.includes('.wav'));
        });
        
        if (!targetWindow) {
            console.log('Media player window not found. Trying first active session...');
            const activeSession = sessions.find(s => s.isActive);
            if (activeSession) {
                targetWindow = { processId: activeSession.processId };
            }
        }
        
        if (!targetWindow) {
            console.error('No media player or active audio session found');
            return;
        }
        
        console.log(`Target process ID: ${targetWindow.processId}`);
        console.log(`Target window ID: ${targetWindow.id}`);
        
        // Step 5: Capture audio
        console.log('\n4. Starting audio capture...');
        let capturedData = [];
        let captureResult = null;
        
        try {
            // Try streaming
            captureResult = await audioCapture.startStreamCapture(
                targetWindow.id || targetWindow.processId,
                (audioData) => {
                    if (audioData && audioData.length > 0) {
                        capturedData.push(...audioData);
                        if (capturedData.length % 48000 === 0) {
                            process.stdout.write('.');
                        }
                    }
                }
            );
            
            if (!captureResult.success) {
                throw new Error('Streaming capture failed');
            }
            
            console.log(`\n✓ Capture started (${captureResult.sampleRate}Hz)`);
            
        } catch (err) {
            console.log(`\nStreaming failed: ${err.message}`);
            
            // Try polling
            captureResult = await audioCapture.startCapture(targetWindow.id || targetWindow.processId);
            if (captureResult.success) {
                console.log('✓ Polling capture started');
                
                const pollInterval = setInterval(() => {
                    const data = audioCapture.getAudioData();
                    if (data && data.length > 0) {
                        capturedData.push(...data);
                        process.stdout.write('.');
                    }
                }, 100);
                
                captureResult.pollInterval = pollInterval;
            }
        }
        
        // Capture for duration
        console.log(`\nCapturing for ${CAPTURE_DURATION/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, CAPTURE_DURATION));
        
        // Stop capture
        console.log('\n\n5. Stopping capture...');
        if (captureResult?.pollInterval) {
            clearInterval(captureResult.pollInterval);
        }
        await audioCapture.stopCapture();
        
        // Kill media players
        exec('taskkill /F /IM vlc.exe 2>nul', () => {});
        exec('taskkill /F /IM wmplayer.exe 2>nul', () => {});
        
        // Analyze results
        console.log(`\nTotal samples captured: ${capturedData.length}`);
        
        if (capturedData.length > 0) {
            const audioArray = new Float32Array(capturedData);
            const sampleRate = captureResult.sampleRate || 48000;
            
            // Simple frequency detection
            const freq = detectFrequency(audioArray, sampleRate);
            
            // Calculate RMS
            let sum = 0;
            for (let i = 0; i < audioArray.length; i++) {
                sum += audioArray[i] * audioArray[i];
            }
            const rms = Math.sqrt(sum / audioArray.length);
            
            console.log('\n=== Results ===');
            console.log(`RMS Level: ${rms.toFixed(4)}`);
            console.log(`Detected Frequency: ${freq.toFixed(1)} Hz`);
            console.log(`Expected: 440 Hz`);
            console.log(`Error: ${Math.abs(freq - 440).toFixed(1)} Hz`);
            
            // Save audio
            const wavPath = path.join(__dirname, 'captured-media.wav');
            createWavFile(audioArray, sampleRate, wavPath);
            console.log(`\nCaptured audio saved to: ${wavPath}`);
            
            if (rms > 0.001 && Math.abs(freq - 440) < 50) {
                console.log('\n✅ TEST PASSED');
            } else if (rms > 0.001) {
                console.log('\n⚠️  TEST PARTIAL: Audio captured but frequency off');
            } else {
                console.log('\n❌ TEST FAILED: No meaningful audio');
            }
        } else {
            console.log('\n❌ TEST FAILED: No audio captured');
            console.log('\nMake sure:');
            console.log('- Running as administrator');
            console.log('- Media player is not muted');
            console.log('- Audio is playing through speakers (not exclusive mode)');
        }
        
    } catch (error) {
        console.error('\n❌ ERROR:', error.message);
        
        // Cleanup
        exec('taskkill /F /IM vlc.exe 2>nul', () => {});
        exec('taskkill /F /IM wmplayer.exe 2>nul', () => {});
    }
}

/**
 * Simple frequency detection
 */
function detectFrequency(samples, sampleRate) {
    // Use middle portion of audio
    const start = Math.floor(samples.length * 0.25);
    const end = Math.floor(samples.length * 0.75);
    
    let crossings = 0;
    let lastSample = samples[start];
    
    for (let i = start + 1; i < end; i++) {
        if ((lastSample < 0 && samples[i] >= 0) || 
            (lastSample >= 0 && samples[i] < 0)) {
            crossings++;
        }
        lastSample = samples[i];
    }
    
    const duration = (end - start) / sampleRate;
    return (crossings / 2) / duration;
}

/**
 * Create WAV file
 */
function createWavFile(samples, sampleRate, outputPath) {
    const length = samples.length;
    const buffer = Buffer.alloc(44 + length * 2);
    
    // Header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + length * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(length * 2, 40);
    
    // Data
    let offset = 44;
    for (let i = 0; i < length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        buffer.writeInt16LE(Math.floor(sample * 32767), offset);
        offset += 2;
    }
    
    fs.writeFileSync(outputPath, buffer);
}

// Check if admin
exec('net session', (error) => {
    if (error) {
        console.log('⚠️  WARNING: Not administrator - capture will likely fail\n');
    } else {
        console.log('✓ Running as administrator\n');
    }
    
    runTest();
});