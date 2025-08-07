const path = require('path');
const fs = require('fs');
const http = require('http');
const { exec } = require('child_process');

// Load the window-audio-capture module
const audioCapture = require('../../native-modules/window-audio-capture');

// Constants
const CAPTURE_DURATION = 5000; // ms
const SERVER_PORT = 8888;

/**
 * Create a simple HTTP server to serve the tone generator HTML
 */
function startWebServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            if (req.url === '/') {
                // Serve the tone generator HTML
                const htmlPath = path.join(__dirname, 'tone-generator.html');
                const html = fs.readFileSync(htmlPath, 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(html);
            } else {
                res.writeHead(404);
                res.end('Not found');
            }
        });
        
        server.listen(SERVER_PORT, () => {
            console.log(`Web server started at http://localhost:${SERVER_PORT}`);
            resolve(server);
        });
    });
}

/**
 * Open the tone generator in browser
 */
function openToneGenerator() {
    return new Promise((resolve) => {
        const url = `http://localhost:${SERVER_PORT}`;
        
        console.log('Opening tone generator in browser...');
        console.log('The page will auto-play a 440Hz tone after 2 seconds');
        
        exec(`start ${url}`, (error) => {
            if (error) {
                console.error('Failed to open browser:', error);
            }
            // Give time for browser to open and tone to start playing
            setTimeout(resolve, 5000);
        });
    });
}

/**
 * Main test function
 */
async function runTest() {
    console.log('=== Browser Audio Capture Test ===\n');
    console.log('This test will:');
    console.log('1. Start a local web server');
    console.log('2. Open the tone generator in your browser');
    console.log('3. Capture audio from the browser');
    console.log('4. Analyze and save the captured audio\n');
    
    let server = null;
    
    try {
        // Step 1: Start web server
        server = await startWebServer();
        
        // Step 2: Open browser
        await openToneGenerator();
        
        // Step 3: Find browser window
        console.log('\nFinding browser window...');
        const windows = await audioCapture.getWindowList();
        
        const browserWindow = windows.find(w => {
            const exe = w.executableName.toLowerCase();
            const title = w.title.toLowerCase();
            return (exe.includes('chrome.exe') || 
                    exe.includes('msedge.exe') || 
                    exe.includes('firefox.exe')) &&
                   (title.includes('440hz') || title.includes('tone generator'));
        });
        
        if (!browserWindow) {
            console.error('Could not find browser window with tone generator');
            console.log('Available browser windows:');
            windows.forEach(w => {
                const exe = w.executableName.toLowerCase();
                if (exe.includes('chrome') || exe.includes('edge') || exe.includes('firefox')) {
                    console.log(`  - ${w.executableName}: "${w.title}"`);
                }
            });
            process.exit(1);
        }
        
        console.log(`Found browser: ${browserWindow.executableName}`);
        console.log(`Window: "${browserWindow.title}"`);
        console.log(`Process ID: ${browserWindow.processId}`);
        
        // Step 4: Check audio sessions
        console.log('\nChecking audio sessions...');
        const sessions = await audioCapture.getAudioSessions();
        console.log(`Found ${sessions.length} audio sessions`);
        
        // Step 5: Start capture
        console.log('\nStarting audio capture...');
        let capturedData = [];
        let captureResult = null;
        let captureMethod = null;
        
        // Try streaming capture first
        try {
            captureResult = await audioCapture.startStreamCapture(
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
            
            if (captureResult.success) {
                captureMethod = 'streaming';
                console.log(`✓ Streaming capture started (${captureResult.sampleRate}Hz, ${captureResult.channels}ch)`);
            }
        } catch (err) {
            console.log('Streaming capture failed:', err.message);
            
            // Try polling capture
            try {
                captureResult = await audioCapture.startCapture(browserWindow.processId);
                if (captureResult.success) {
                    captureMethod = 'polling';
                    console.log(`✓ Polling capture started (${captureResult.sampleRate}Hz, ${captureResult.channels}ch)`);
                    
                    // Set up polling
                    const pollInterval = setInterval(() => {
                        const data = audioCapture.getAudioData();
                        if (data && data.length > 0) {
                            capturedData.push(...data);
                            process.stdout.write('.');
                        }
                    }, 100);
                    
                    // Store for cleanup
                    captureResult.pollInterval = pollInterval;
                }
            } catch (err2) {
                console.error('All capture methods failed');
                console.error('Make sure to run this test as administrator');
                process.exit(1);
            }
        }
        
        // Step 6: Capture for duration
        console.log(`\nCapturing for ${CAPTURE_DURATION/1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, CAPTURE_DURATION));
        
        // Step 7: Stop capture
        console.log('\n\nStopping capture...');
        if (captureMethod === 'polling' && captureResult.pollInterval) {
            clearInterval(captureResult.pollInterval);
        }
        await audioCapture.stopCapture();
        
        // Step 8: Analyze results
        console.log(`\nTotal samples captured: ${capturedData.length}`);
        
        if (capturedData.length > 0) {
            const audioArray = new Float32Array(capturedData);
            const sampleRate = captureResult.sampleRate || 48000;
            
            // Simple frequency detection
            const detectedFreq = detectFrequency(audioArray, sampleRate);
            
            // Calculate RMS
            let sum = 0;
            for (let i = 0; i < audioArray.length; i++) {
                sum += audioArray[i] * audioArray[i];
            }
            const rms = Math.sqrt(sum / audioArray.length);
            
            console.log(`\nAnalysis Results:`);
            console.log(`RMS level: ${rms.toFixed(4)}`);
            console.log(`Detected frequency: ${detectedFreq.toFixed(1)} Hz`);
            console.log(`Expected frequency: 440 Hz`);
            console.log(`Error: ${Math.abs(detectedFreq - 440).toFixed(1)} Hz`);
            
            // Save raw audio
            const rawPath = path.join(__dirname, 'captured-browser.raw');
            fs.writeFileSync(rawPath, Buffer.from(audioArray.buffer));
            console.log(`\nRaw audio saved to: ${rawPath}`);
            
            // Create WAV
            const wavPath = path.join(__dirname, 'captured-browser.wav');
            createWavFile(audioArray, sampleRate, wavPath);
            console.log(`WAV file saved to: ${wavPath}`);
            
            // Determine test result
            const hasAudio = rms > 0.001;
            const frequencyMatch = Math.abs(detectedFreq - 440) < 20;
            
            if (hasAudio && frequencyMatch) {
                console.log('\n✅ TEST PASSED: Successfully captured 440Hz tone');
            } else if (hasAudio) {
                console.log('\n⚠️  TEST PARTIAL: Audio captured but frequency off');
                console.log('This might be due to resampling or capture artifacts');
            } else {
                console.log('\n❌ TEST FAILED: No meaningful audio captured');
            }
            
            console.log('\nYou can verify the captured audio:');
            console.log(`  start ${wavPath}`);
        } else {
            console.log('\n❌ TEST FAILED: No audio captured');
            console.log('\nPossible reasons:');
            console.log('- Browser blocked autoplay (check browser console)');
            console.log('- Need administrator privileges');
            console.log('- Browser audio is muted');
        }
        
    } catch (error) {
        console.error('\n❌ TEST ERROR:', error.message);
        console.error(error.stack);
    } finally {
        // Cleanup
        if (server) {
            console.log('\nShutting down web server...');
            server.close();
        }
    }
}

/**
 * Simple frequency detection using zero-crossing
 */
function detectFrequency(samples, sampleRate) {
    // Skip the first second to avoid startup artifacts
    const startIdx = Math.min(sampleRate, samples.length / 4);
    const endIdx = Math.min(startIdx + sampleRate * 2, samples.length);
    
    if (endIdx <= startIdx) return 0;
    
    // Count zero crossings
    let crossings = 0;
    let lastSample = samples[startIdx];
    
    for (let i = startIdx + 1; i < endIdx; i++) {
        if ((lastSample < 0 && samples[i] >= 0) || (lastSample >= 0 && samples[i] < 0)) {
            crossings++;
        }
        lastSample = samples[i];
    }
    
    // Calculate frequency from zero crossings
    const duration = (endIdx - startIdx) / sampleRate;
    const frequency = (crossings / 2) / duration;
    
    return frequency;
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
        console.log('Audio capture will likely fail. Please run as admin.\n');
    } else {
        console.log('✓ Running with administrator privileges\n');
    }
    
    runTest();
});