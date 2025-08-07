// Test session-based capture with Windows Media Player
const audioCapture = require('../../native-modules/window-audio-capture');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

async function runTest() {
    console.log('=== Session-Based Audio Capture Test (WMP) ===\n');
    
    try {
        // Step 1: Play audio file with Windows Media Player
        console.log('1. Playing test tone with Windows Media Player...');
        const wavFile = path.join(__dirname, 'test-tone-440hz.wav');
        
        if (!fs.existsSync(wavFile)) {
            console.error('Test tone file not found:', wavFile);
            return;
        }
        
        exec(`start wmplayer "${wavFile}"`);
        
        // Wait for WMP to start
        console.log('Waiting for Windows Media Player to start...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Step 2: Find WMP window
        console.log('\n2. Finding Windows Media Player window...');
        const windows = audioCapture.getWindowList();
        const wmpWindow = windows.find(w => w.executableName.toLowerCase().includes('wmplayer.exe'));
        
        if (!wmpWindow) {
            console.error('Windows Media Player not found');
            return;
        }
        
        console.log(`Found: ${wmpWindow.title} (PID: ${wmpWindow.processId})`);
        
        // Step 3: Check audio sessions
        console.log('\n3. Checking audio sessions...');
        const sessions = audioCapture.getAudioSessions();
        const wmpSession = sessions.find(s => s.processId === wmpWindow.processId);
        
        if (wmpSession) {
            console.log(`WMP session found: ${wmpSession.isActive ? 'ACTIVE' : 'INACTIVE'}`);
        } else {
            console.log('No WMP audio session found yet');
        }
        
        // Step 4: Start capture
        console.log('\n4. Starting audio capture...');
        const result = audioCapture.startCapture(wmpWindow.id);
        
        if (!result.success) {
            console.error('Failed to start capture:', result.error);
            return;
        }
        
        console.log('✓ Capture started successfully');
        console.log(`Sample rate: ${result.sampleRate} Hz`);
        console.log(`Channels: ${result.channels}`);
        if (result.warning) {
            console.log(`⚠️  ${result.warning}`);
        }
        
        // Step 5: Capture audio for 5 seconds
        console.log('\n5. Capturing audio for 5 seconds...');
        const capturedData = [];
        const captureInterval = setInterval(() => {
            const data = audioCapture.getAudioData();
            if (data && data.length > 0) {
                capturedData.push(...data);
                process.stdout.write('.');
            }
        }, 100);
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        clearInterval(captureInterval);
        
        console.log(`\n\nTotal samples captured: ${capturedData.length}`);
        
        // Step 6: Analyze captured audio
        if (capturedData.length > 0) {
            const samples = new Float32Array(capturedData);
            const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
            console.log(`Audio RMS level: ${rms.toFixed(4)}`);
            
            if (rms > 0.01) {
                console.log('\n✅ SUCCESS: Audio captured!');
                console.log('\n⚠️  NOTE: This uses session-based capture.');
                console.log('Audio is only captured when the target app is actively playing.');
                console.log('If you hear other system sounds, they may be mixed in.');
            } else {
                console.log('\n⚠️  Audio captured but very quiet');
            }
        } else {
            console.log('\n❌ No audio captured');
        }
        
        // Step 7: Stop capture
        audioCapture.stopCapture();
        console.log('\n✓ Capture stopped');
        
        // Close WMP
        exec('taskkill /IM wmplayer.exe /F', (err) => {
            if (!err) console.log('✓ Windows Media Player closed');
        });
        
    } catch (error) {
        console.error('\nError:', error);
    }
}

runTest();