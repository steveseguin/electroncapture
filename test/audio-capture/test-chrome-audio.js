// Test audio capture with Chrome browser
const audioCapture = require('../../native-modules/window-audio-capture');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CAPTURE_DURATION = 5000; // 5 seconds
const OUTPUT_FILE = 'captured-chrome.wav';

async function runTest() {
    console.log('=== Chrome Audio Capture Test ===\n');
    
    try {
        // Step 1: Launch Chrome with a YouTube video or audio test page
        console.log('1. Opening audio test page in Chrome...');
        const testUrl = 'https://www.youtube.com/watch?v=jNQXAC9IVRw'; // "Me at the zoo" - first YouTube video
        exec(`start chrome "${testUrl}"`);
        
        // Wait for Chrome to load
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Step 2: Get window list
        console.log('\n2. Finding Chrome window...');
        const windows = await audioCapture.getWindowList();
        
        const chromeWindow = windows.find(w => {
            const exe = w.executableName.toLowerCase();
            return exe.includes('chrome.exe') && 
                   (w.title.includes('YouTube') || w.title.includes('audio'));
        });
        
        if (!chromeWindow) {
            console.error('Chrome window with audio not found');
            console.log('Available windows:');
            windows.filter(w => w.executableName.toLowerCase().includes('chrome')).forEach(w => {
                console.log(`  - ${w.title} (PID: ${w.processId})`);
            });
            return;
        }
        
        console.log(`Found Chrome: "${chromeWindow.title}"`);
        console.log(`Process ID: ${chromeWindow.processId}`);
        console.log(`Window ID: ${chromeWindow.id}`);
        
        // Step 3: Check audio sessions
        console.log('\n3. Checking audio sessions...');
        const sessions = await audioCapture.getAudioSessions();
        const chromeSession = sessions.find(s => s.processId === chromeWindow.processId);
        
        if (chromeSession) {
            console.log(`Chrome audio session found: ${chromeSession.isActive ? 'ACTIVE' : 'INACTIVE'}`);
        } else {
            console.log('No Chrome audio session found yet');
        }
        
        // Step 4: Start capture
        console.log('\n4. Starting audio capture...');
        console.log('Using window ID:', chromeWindow.id);
        
        const captureResult = await audioCapture.startCapture(chromeWindow.id);
        
        if (!captureResult.success) {
            console.error('Failed to start capture:', captureResult.error || 'Unknown error');
            return;
        }
        
        console.log('✓ Capture started successfully');
        console.log(`Sample rate: ${captureResult.sampleRate} Hz`);
        console.log(`Channels: ${captureResult.channels}`);
        console.log(`Format: ${captureResult.format}`);
        
        // Step 5: Capture audio
        console.log(`\n5. Capturing audio for ${CAPTURE_DURATION/1000} seconds...`);
        
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
        
        // Step 6: Stop capture
        console.log('\n\n6. Stopping capture...');
        audioCapture.stopCapture();
        
        console.log(`Total samples captured: ${capturedData.length}`);
        
        if (capturedData.length === 0) {
            console.error('\n❌ TEST FAILED: No audio captured');
            return;
        }
        
        // Step 7: Save audio
        console.log('\n7. Saving captured audio...');
        const audioBuffer = Buffer.from(capturedData.buffer);
        
        // Create WAV header
        const wavHeader = createWAVHeader(audioBuffer.length, captureResult.sampleRate, captureResult.channels, 16);
        const wavFile = Buffer.concat([wavHeader, audioBuffer]);
        
        fs.writeFileSync(OUTPUT_FILE, wavFile);
        console.log(`Captured audio saved to: ${path.resolve(OUTPUT_FILE)}`);
        
        // Calculate RMS
        const samples = new Float32Array(capturedData);
        const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
        console.log(`\nAudio RMS level: ${rms.toFixed(4)}`);
        
        if (rms > 0.01) {
            console.log('\n✅ TEST PASSED: Audio successfully captured from Chrome!');
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
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM format
    buffer.writeUInt16LE(channels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * channels * bitsPerSample / 8, 28); // byte rate
    buffer.writeUInt16LE(channels * bitsPerSample / 8, 32); // block align
    buffer.writeUInt16LE(bitsPerSample, 34);
    
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    
    return buffer;
}

// Run the test
runTest().catch(console.error);