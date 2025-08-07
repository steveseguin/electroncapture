// Test audio capture with a game or other application
const audioCapture = require('../../native-modules/window-audio-capture');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const CAPTURE_DURATION = 5000; // 5 seconds

async function runTest() {
    console.log('=== Application Audio Capture Test ===\n');
    
    try {
        // Step 1: List available windows and audio sessions
        console.log('1. Checking for applications with audio...\n');
        
        const windows = await audioCapture.getWindowList();
        const sessions = await audioCapture.getAudioSessions();
        
        console.log(`Found ${windows.length} windows`);
        console.log(`Found ${sessions.length} audio sessions\n`);
        
        // Look for applications that typically have audio
        const audioApps = windows.filter(w => {
            const exe = w.executableName.toLowerCase();
            const title = w.title.toLowerCase();
            
            // Games and media applications that might support process-specific capture
            return (
                // Games
                exe.includes('game') ||
                exe.includes('minecraft') ||
                exe.includes('fortnite') ||
                exe.includes('valorant') ||
                exe.includes('csgo') ||
                exe.includes('dota') ||
                exe.includes('league') ||
                // Media apps
                exe.includes('spotify') ||
                exe.includes('groove') ||
                exe.includes('vlc') ||
                exe.includes('foobar') ||
                exe.includes('winamp') ||
                exe.includes('audacity') ||
                // Communication apps
                exe.includes('discord') ||
                exe.includes('teams') ||
                exe.includes('zoom') ||
                exe.includes('skype') ||
                // System sounds
                exe.includes('explorer.exe') ||
                // Any window with audio-related title
                title.includes('audio') ||
                title.includes('music') ||
                title.includes('sound')
            ) && !exe.includes('chrome') && !exe.includes('firefox') && !exe.includes('edge');
        });
        
        console.log('Applications that might have audio:');
        audioApps.forEach(w => {
            const session = sessions.find(s => s.processId === w.processId);
            console.log(`- ${w.executableName} "${w.title}" (PID: ${w.processId}) ${session ? '[HAS AUDIO SESSION]' : ''}`);
        });
        
        // Find active audio sessions
        const activeSessions = sessions.filter(s => s.isActive);
        console.log(`\nActive audio sessions (${activeSessions.length}):`);
        activeSessions.forEach(s => {
            const window = windows.find(w => w.processId === s.processId);
            if (window) {
                console.log(`- ${window.executableName} (PID: ${s.processId})`);
            } else {
                console.log(`- Unknown process (PID: ${s.processId})`);
            }
        });
        
        // Let user choose
        console.log('\n2. Select an application to capture:');
        console.log('Looking for the first available audio source...\n');
        
        // Try to find a suitable target
        let targetWindow = null;
        
        // First, try active audio sessions
        for (const session of activeSessions) {
            const window = windows.find(w => w.processId === session.processId);
            if (window && !window.executableName.toLowerCase().includes('wmplayer')) {
                targetWindow = window;
                break;
            }
        }
        
        // If no active session, try known apps
        if (!targetWindow && audioApps.length > 0) {
            targetWindow = audioApps[0];
        }
        
        if (!targetWindow) {
            console.error('No suitable application found for audio capture');
            console.log('\nPlease start an application that plays audio (game, Spotify, etc.)');
            return;
        }
        
        console.log(`Selected: ${targetWindow.executableName} "${targetWindow.title}"`);
        console.log(`Process ID: ${targetWindow.processId}`);
        console.log(`Window ID: ${targetWindow.id}`);
        
        // Step 3: Start capture
        console.log('\n3. Starting audio capture...');
        console.log('Using window ID:', targetWindow.id);
        
        const captureResult = await audioCapture.startCapture(targetWindow.id);
        
        if (!captureResult.success) {
            console.error('\n❌ Failed to start capture:', captureResult.error || 'Unknown error');
            
            // Check if we're admin
            exec('net session', (error) => {
                if (error) {
                    console.log('\n⚠️  Not running as administrator');
                    console.log('Process-specific audio capture requires admin privileges');
                    console.log('Please run this test as administrator');
                } else {
                    console.log('\n✓ Running as administrator');
                    console.log('The application may not support process-specific audio capture');
                    console.log('Try a different application (game, Spotify, etc.)');
                }
            });
            return;
        }
        
        console.log('✓ Capture started successfully');
        console.log(`Sample rate: ${captureResult.sampleRate} Hz`);
        console.log(`Channels: ${captureResult.channels}`);
        console.log(`Format: ${captureResult.format}`);
        
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
        
        if (rms > 0.01) {
            console.log(`\n✅ TEST PASSED: Audio successfully captured from ${targetWindow.executableName}!`);
        } else {
            console.log('\n⚠️  TEST WARNING: Audio captured but very quiet');
        }
        
    } catch (err) {
        console.error('\n❌ TEST ERROR:', err.message);
        console.error(err);
    }
}

// Run the test
runTest().catch(console.error);