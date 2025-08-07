const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// Load the window-audio-capture module
const audioCapture = require('../../native-modules/window-audio-capture');

// Constants
const CAPTURE_DURATION = 5000; // ms

/**
 * Open YouTube with a test tone video
 */
function openYouTubeTone() {
    return new Promise((resolve) => {
        // 440Hz test tone video on YouTube
        const youtubeUrl = 'https://www.youtube.com/watch?v=CAqN0sRpfGY';
        
        console.log('Opening YouTube 440Hz test tone...');
        console.log('Please click play on the video when it opens!');
        
        exec(`start ${youtubeUrl}`, (error) => {
            if (error) {
                console.error('Failed to open YouTube:', error);
            }
            // Give time for browser to open and user to click play
            setTimeout(resolve, 5000);
        });
    });
}

/**
 * Main test function
 */
async function runTest() {
    console.log('=== YouTube Audio Capture Test ===\n');
    console.log('This test will:');
    console.log('1. Open a YouTube 440Hz test tone');
    console.log('2. Capture audio from your browser');
    console.log('3. Save the captured audio\n');
    
    try {
        // Step 1: Open YouTube
        await openYouTubeTone();
        
        // Step 2: Find browser window
        console.log('\nFinding browser window...');
        const windows = await audioCapture.getWindowList();
        
        const browserWindow = windows.find(w => {
            const exe = w.executableName.toLowerCase();
            return (exe.includes('chrome.exe') || 
                    exe.includes('msedge.exe') || 
                    exe.includes('firefox.exe')) &&
                   w.title.toLowerCase().includes('youtube');
        });
        
        if (!browserWindow) {
            console.error('Could not find browser window with YouTube');
            console.log('Available windows:');
            windows.forEach(w => {
                if (w.executableName.toLowerCase().includes('chrome') ||
                    w.executableName.toLowerCase().includes('edge') ||
                    w.executableName.toLowerCase().includes('firefox')) {
                    console.log(`  - ${w.executableName}: "${w.title}"`);
                }
            });
            process.exit(1);
        }
        
        console.log(`Found browser: ${browserWindow.executableName}`);
        console.log(`Window: "${browserWindow.title}"`);
        console.log(`Process ID: ${browserWindow.processId}`);
        
        // Step 3: Check audio sessions
        console.log('\nChecking audio sessions...');
        const sessions = await audioCapture.getAudioSessions();
        console.log(`Found ${sessions.length} audio sessions`);
        
        const browserSession = sessions.find(s => s.processId === browserWindow.processId);
        if (browserSession) {
            console.log('Found matching audio session');
        }
        
        // Step 4: Start capture
        console.log('\nStarting audio capture...');
        let capturedData = [];
        let captureMethod = null;
        
        // Try streaming capture first
        try {
            const result = await audioCapture.startStreamCapture(
                browserWindow.processId,
                (audioData) => {
                    if (audioData && audioData.length > 0) {
                        capturedData.push(...audioData);
                        // Show progress
                        if (capturedData.length % 48000 === 0) {
                            process.stdout.write('.');
                        }
                    }
                }
            );
            
            if (result.success) {
                captureMethod = 'streaming';
                console.log(`✓ Streaming capture started (${result.sampleRate}Hz, ${result.channels}ch)`);
            }
        } catch (err) {
            console.log('Streaming capture failed:', err.message);
            
            // Try polling capture
            try {
                const result = await audioCapture.startCapture(browserWindow.processId);
                if (result.success) {
                    captureMethod = 'polling';
                    console.log(`✓ Polling capture started (${result.sampleRate}Hz, ${result.channels}ch)`);
                    
                    // Set up polling
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
                console.error('All capture methods failed');
                process.exit(1);
            }
        }
        
        // Step 5: Capture for duration
        console.log(`\nCapturing for ${CAPTURE_DURATION/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, CAPTURE_DURATION));
        
        // Step 6: Stop capture
        console.log('\n\nStopping capture...');
        if (captureMethod === 'polling' && result.pollInterval) {
            clearInterval(result.pollInterval);
        }
        await audioCapture.stopCapture();
        
        // Step 7: Save results
        console.log(`\nTotal samples captured: ${capturedData.length}`);
        
        if (capturedData.length > 0) {
            const audioArray = new Float32Array(capturedData);
            
            // Calculate RMS
            let sum = 0;
            for (let i = 0; i < audioArray.length; i++) {
                sum += audioArray[i] * audioArray[i];
            }
            const rms = Math.sqrt(sum / audioArray.length);
            console.log(`RMS level: ${rms.toFixed(4)}`);
            
            // Save raw audio
            const rawPath = path.join(__dirname, 'captured-youtube.raw');
            fs.writeFileSync(rawPath, Buffer.from(audioArray.buffer));
            console.log(`\nRaw audio saved to: ${rawPath}`);
            
            // Create WAV
            const wavPath = path.join(__dirname, 'captured-youtube.wav');
            createWavFile(audioArray, 48000, wavPath);
            console.log(`WAV file saved to: ${wavPath}`);
            
            console.log('\n✅ TEST PASSED: Audio captured successfully');
            console.log('\nYou can play the captured audio with:');
            console.log(`  start ${wavPath}`);
        } else {
            console.log('\n❌ TEST FAILED: No audio captured');
            console.log('\nPossible reasons:');
            console.log('- Did not click play on YouTube video');
            console.log('- Need administrator privileges');
            console.log('- Browser audio is muted');
        }
        
    } catch (error) {
        console.error('\n❌ TEST ERROR:', error.message);
        console.error(error.stack);
    }
}

/**
 * Create a WAV file from float32 samples
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

// Check admin status
exec('net session', (error) => {
    if (error) {
        console.log('⚠️  WARNING: Not running as administrator');
        console.log('Audio capture may fail. For best results, run as admin.\n');
    } else {
        console.log('✓ Running with administrator privileges\n');
    }
    
    runTest();
});