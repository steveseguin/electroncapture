const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');

// Load the window-audio-capture module
const audioCapture = require('../../native-modules/window-audio-capture');

// Constants
const CAPTURE_DURATION = 5000; // ms
const TARGET_FREQUENCY = 440; // Hz

/**
 * Launch PowerShell tone player
 */
function playToneWithPowerShell() {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, 'play-tone.ps1');
        
        console.log('Starting PowerShell tone player...');
        
        // Launch PowerShell in a new window
        const ps = spawn('powershell.exe', [
            '-ExecutionPolicy', 'Bypass',
            '-File', scriptPath,
            '-Frequency', '440',
            '-Duration', '4000'  // 4 seconds
        ], {
            detached: true,
            stdio: 'ignore'
        });
        
        ps.unref();
        
        // Give it time to start
        setTimeout(resolve, 1000);
    });
}

/**
 * Find PowerShell window and capture audio
 */
async function captureFromPowerShell() {
    // Get all windows
    const windows = await audioCapture.getWindowList();
    console.log(`Found ${windows.length} windows`);
    
    // Find PowerShell window
    const psWindow = windows.find(w => {
        const exe = w.executableName.toLowerCase();
        const title = w.title.toLowerCase();
        return exe.includes('powershell.exe') && 
               (title.includes('tone') || title.includes('powershell'));
    });
    
    if (!psWindow) {
        console.log('PowerShell window not found, trying conhost...');
        // Sometimes PowerShell runs under conhost
        const conWindow = windows.find(w => 
            w.executableName.toLowerCase().includes('conhost.exe'));
        if (conWindow) {
            return conWindow;
        }
        return null;
    }
    
    return psWindow;
}

/**
 * Main test function
 */
async function runTest() {
    console.log('=== PowerShell Tone Capture Test ===\n');
    console.log('This test uses PowerShell Console.Beep to generate audio\n');
    
    try {
        // Step 1: Check audio sessions before playing
        console.log('1. Checking initial audio sessions...');
        let sessions = await audioCapture.getAudioSessions();
        console.log(`Found ${sessions.length} audio sessions`);
        
        // Step 2: Play tone
        console.log('\n2. Playing 440Hz tone with PowerShell...');
        await playToneWithPowerShell();
        
        // Step 3: Check audio sessions again
        console.log('\n3. Checking audio sessions after tone start...');
        sessions = await audioCapture.getAudioSessions();
        console.log(`Found ${sessions.length} audio sessions`);
        
        if (sessions.length > 0) {
            console.log('Active sessions:');
            sessions.forEach(s => {
                console.log(`  - Process ${s.processId}: ${s.sessionName || 'Unknown'} (Active: ${s.isActive})`);
            });
        }
        
        // Step 4: Try to capture from any active session
        console.log('\n4. Attempting audio capture...');
        let capturedData = [];
        let captureSuccess = false;
        
        // Find an active session
        const activeSession = sessions.find(s => s.isActive);
        
        if (activeSession) {
            console.log(`Capturing from active session: Process ${activeSession.processId}`);
            
            try {
                // Try streaming capture
                const result = await audioCapture.startStreamCapture(
                    activeSession.processId,
                    (audioData) => {
                        if (audioData && audioData.length > 0) {
                            capturedData.push(...audioData);
                            process.stdout.write('.');
                        }
                    }
                );
                
                if (result.success) {
                    captureSuccess = true;
                    console.log(`\n✓ Capture started (${result.sampleRate}Hz)`);
                }
            } catch (err) {
                console.log(`\nStreaming failed: ${err.message}`);
                
                // Try polling
                try {
                    const result = await audioCapture.startCapture(activeSession.processId);
                    if (result.success) {
                        captureSuccess = true;
                        console.log(`✓ Polling capture started`);
                        
                        // Poll for data
                        const pollInterval = setInterval(() => {
                            const data = audioCapture.getAudioData();
                            if (data && data.length > 0) {
                                capturedData.push(...data);
                                process.stdout.write('.');
                            }
                        }, 100);
                        
                        // Store for cleanup
                        result.pollInterval = pollInterval;
                    }
                } catch (err2) {
                    console.log(`Polling failed: ${err2.message}`);
                }
            }
        } else {
            console.log('No active audio sessions found');
            console.log('\nNOTE: Console.Beep may not create a capturable audio session');
            console.log('This is a Windows limitation with system beeps');
        }
        
        if (captureSuccess) {
            // Capture for duration
            console.log(`\nCapturing for ${CAPTURE_DURATION/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, CAPTURE_DURATION));
            
            // Stop capture
            console.log('\n\nStopping capture...');
            if (result?.pollInterval) {
                clearInterval(result.pollInterval);
            }
            await audioCapture.stopCapture();
            
            console.log(`Total samples captured: ${capturedData.length}`);
            
            if (capturedData.length > 0) {
                // Save and analyze
                const audioArray = new Float32Array(capturedData);
                
                // Save audio
                const wavPath = path.join(__dirname, 'captured-powershell.wav');
                createWavFile(audioArray, 48000, wavPath);
                console.log(`\nAudio saved to: ${wavPath}`);
                
                console.log('\n✅ TEST PASSED: Audio captured');
            } else {
                console.log('\n❌ No audio data captured');
            }
        } else {
            console.log('\n❌ TEST RESULT: Unable to capture audio');
            console.log('\nThis is expected behavior - Console.Beep uses the PC speaker');
            console.log('which bypasses the normal Windows audio system.');
            console.log('\nFor actual audio capture testing, we need an application');
            console.log('that plays audio through Windows Audio Session API.');
        }
        
        // Kill PowerShell windows
        exec('taskkill /F /IM powershell.exe 2>nul', () => {});
        
    } catch (error) {
        console.error('\n❌ TEST ERROR:', error.message);
        console.error(error.stack);
    }
}

/**
 * Create a WAV file
 */
function createWavFile(samples, sampleRate, outputPath) {
    const length = samples.length;
    const arrayBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(arrayBuffer);
    
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
    
    let offset = 44;
    for (let i = 0; i < length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, sample * 0x7FFF, true);
        offset += 2;
    }
    
    fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
}

// Run test
exec('net session', (error) => {
    if (error) {
        console.log('⚠️  Not running as administrator\n');
    } else {
        console.log('✓ Running as administrator\n');
    }
    
    runTest();
});