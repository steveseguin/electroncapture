// Test session-based audio capture
const audioCapture = require('../../native-modules/window-audio-capture');

async function test() {
    console.log('=== Session-Based Audio Capture Test ===\n');
    
    try {
        // Get windows
        console.log('1. Getting window list...');
        const windows = await audioCapture.getWindowList();
        console.log(`Found ${windows.length} windows`);
        
        // Get audio sessions
        console.log('\n2. Getting audio sessions...');
        const sessions = await audioCapture.getAudioSessions();
        console.log(`Found ${sessions.length} audio sessions`);
        
        // Show active sessions
        const activeSessions = sessions.filter(s => s.isActive);
        console.log(`\nActive sessions: ${activeSessions.length}`);
        activeSessions.forEach(s => {
            const window = windows.find(w => w.processId === s.processId);
            if (window) {
                console.log(`  - ${window.executableName} (PID: ${s.processId})`);
            }
        });
        
        // Try to capture from first active session
        if (activeSessions.length > 0) {
            const targetSession = activeSessions[0];
            const targetWindow = windows.find(w => w.processId === targetSession.processId);
            
            if (targetWindow) {
                console.log(`\n3. Starting capture from: ${targetWindow.executableName}`);
                const result = await audioCapture.startCapture(targetWindow.id);
                
                if (result.success) {
                    console.log('✓ Capture started successfully');
                    console.log(`Sample rate: ${result.sampleRate}`);
                    console.log(`Channels: ${result.channels}`);
                    if (result.warning) {
                        console.log(`Warning: ${result.warning}`);
                    }
                    
                    // Capture for 3 seconds
                    console.log('\nCapturing audio for 3 seconds...');
                    setTimeout(() => {
                        const data = audioCapture.getAudioData();
                        console.log(`Captured ${data.length} samples`);
                        
                        audioCapture.stopCapture();
                        console.log('✓ Capture stopped');
                    }, 3000);
                } else {
                    console.error('Failed to start capture:', result.error);
                }
            }
        } else {
            console.log('\nNo active audio sessions found');
            console.log('Please start playing audio in an application and try again');
        }
        
    } catch (error) {
        console.error('Error:', error);
    }
}

test();