// Test audio capture with Spotify
const audioCapture = require('../../native-modules/window-audio-capture');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CAPTURE_DURATION = 5000; // 5 seconds

async function runTest() {
    console.log('=== Spotify Audio Capture Test ===\n');
    
    try {
        // Step 1: Find Spotify
        console.log('1. Looking for Spotify...');
        const windows = await audioCapture.getWindowList();
        
        const spotifyWindow = windows.find(w => 
            w.executableName.toLowerCase().includes('spotify.exe')
        );
        
        if (!spotifyWindow) {
            console.error('Spotify not found. Please start Spotify and play some music.');
            return;
        }
        
        console.log(`Found Spotify: "${spotifyWindow.title}"`);
        console.log(`Process ID: ${spotifyWindow.processId}`);
        console.log(`Window ID: ${spotifyWindow.id}`);
        
        // Step 2: Check audio sessions
        console.log('\n2. Checking audio sessions...');
        const sessions = await audioCapture.getAudioSessions();
        const spotifySession = sessions.find(s => s.processId === spotifyWindow.processId);
        
        if (spotifySession) {
            console.log(`Spotify audio session found: ${spotifySession.isActive ? 'ACTIVE' : 'INACTIVE'}`);
        } else {
            console.log('No Spotify audio session found');
        }
        
        // Step 3: Start capture
        console.log('\n3. Starting audio capture...');
        console.log('Using window ID:', spotifyWindow.id);
        
        const captureResult = await audioCapture.startCapture(spotifyWindow.id);
        
        if (!captureResult.success) {
            console.error('\n❌ Failed to start capture:', captureResult.error || 'Unknown error');
            
            // Check admin status
            exec('net session', (error) => {
                if (error) {
                    console.log('\n⚠️  Not running as administrator');
                    console.log('Try running as administrator');
                }
            });
            return;
        }
        
        console.log('✓ Capture started successfully');
        console.log(`Sample rate: ${captureResult.sampleRate} Hz`);
        console.log(`Channels: ${captureResult.channels}`);
        
        // Step 4: Capture audio
        console.log(`\n4. Capturing audio for ${CAPTURE_DURATION/1000} seconds...`);
        
        const capturedData = [];
        const pollInterval = setInterval(() => {
            const data = audioCapture.getAudioData();
            if (data && data.length > 0) {
                capturedData.push(...data);
                process.stdout.write('.');
            }
        }, 100);
        
        await new Promise(resolve => setTimeout(resolve, CAPTURE_DURATION));
        clearInterval(pollInterval);
        
        // Step 5: Stop capture
        console.log('\n\n5. Stopping capture...');
        audioCapture.stopCapture();
        
        console.log(`Total samples captured: ${capturedData.length}`);
        
        if (capturedData.length === 0) {
            console.error('\n❌ TEST FAILED: No audio captured');
            return;
        }
        
        // Calculate RMS
        const samples = new Float32Array(capturedData);
        const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
        console.log(`\nAudio RMS level: ${rms.toFixed(4)}`);
        
        // Save the audio
        const audioBuffer = Buffer.from(capturedData.buffer);
        const outputFile = 'captured-spotify.wav';
        
        // Create simple WAV header
        const wavHeader = createWAVHeader(audioBuffer.length, captureResult.sampleRate, captureResult.channels, 16);
        const wavFile = Buffer.concat([wavHeader, audioBuffer]);
        
        fs.writeFileSync(outputFile, wavFile);
        console.log(`\nCaptured audio saved to: ${path.resolve(outputFile)}`);
        
        if (rms > 0.01) {
            console.log('\n✅ SUCCESS: Audio captured from Spotify!');
            console.log('\nNOTE: If you hear other system sounds mixed in, that means');
            console.log('Spotify doesn\'t support process-specific capture and we\'re');
            console.log('falling back to session-based capture of all system audio.');
        } else {
            console.log('\n⚠️  TEST WARNING: Audio captured but very quiet');
        }
        
    } catch (err) {
        console.error('\n❌ TEST ERROR:', err.message);
        console.error(err);
    }
}

function createWAVHeader(dataSize, sampleRate, channels, bitsPerSample) {
    const buffer = Buffer.alloc(44);
    
    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    
    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28);
    buffer.writeUInt16LE(channels * bitsPerSample / 8, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    
    return buffer;
}

// Run the test
runTest().catch(console.error);