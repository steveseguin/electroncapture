// Diagnostic script to understand audio capture issues

const audioCapture = require('../../native-modules/window-audio-capture');
const { exec } = require('child_process');

console.log('=== Audio Capture Diagnostics ===\n');

async function runDiagnostics() {
    // 1. Check admin status
    exec('net session', async (error) => {
        console.log('Administrator privileges:', error ? 'NO' : 'YES');
        console.log('');
        
        // 2. List all audio sessions with details
        console.log('Audio Sessions:');
        console.log('==============');
        try {
            const sessions = await audioCapture.getAudioSessions();
            console.log(`Total sessions: ${sessions.length}\n`);
            
            sessions.forEach((session, i) => {
                console.log(`Session ${i}:`);
                console.log(`  Process ID: ${session.processId}`);
                console.log(`  Session ID: ${session.sessionId}`);
                console.log(`  Session Name: ${session.sessionName || 'N/A'}`);
                console.log(`  Is Active: ${session.isActive}`);
                console.log('');
            });
        } catch (err) {
            console.error('Failed to get audio sessions:', err.message);
        }
        
        // 3. List windows with process details
        console.log('\nWindows with Audio Capability:');
        console.log('=============================');
        try {
            const windows = await audioCapture.getWindowList();
            
            // Filter for potential audio apps
            const audioApps = windows.filter(w => {
                const exe = w.executableName.toLowerCase();
                return exe.includes('wmplayer') ||
                       exe.includes('vlc') ||
                       exe.includes('chrome') ||
                       exe.includes('firefox') ||
                       exe.includes('edge') ||
                       exe.includes('spotify') ||
                       exe.includes('groove') ||
                       exe.includes('movies') ||
                       exe.includes('music');
            });
            
            audioApps.forEach(w => {
                console.log(`${w.executableName}:`);
                console.log(`  Title: ${w.title}`);
                console.log(`  Process ID: ${w.processId}`);
                console.log(`  Window ID: ${w.id}`);
                console.log('');
            });
        } catch (err) {
            console.error('Failed to get window list:', err.message);
        }
        
        // 4. Test capture methods
        console.log('\nTesting Capture Methods:');
        console.log('=======================');
        
        // Find Windows Media Player
        const windows = await audioCapture.getWindowList();
        const wmp = windows.find(w => w.executableName.toLowerCase().includes('wmplayer'));
        
        if (wmp) {
            console.log(`\nTesting capture for Windows Media Player (PID: ${wmp.processId}):`);
            
            // Test 1: Direct process ID
            console.log('\n1. Testing with process ID directly...');
            try {
                const result = await audioCapture.startCapture(wmp.processId);
                console.log('   Result:', result);
                if (result.success) {
                    await audioCapture.stopCapture();
                    console.log('   ✓ Success!');
                }
            } catch (err) {
                console.log('   ✗ Failed:', err.message);
            }
            
            // Test 2: Window ID
            console.log('\n2. Testing with window ID...');
            try {
                const result = await audioCapture.startCapture(wmp.id);
                console.log('   Result:', result);
                if (result.success) {
                    await audioCapture.stopCapture();
                    console.log('   ✓ Success!');
                }
            } catch (err) {
                console.log('   ✗ Failed:', err.message);
            }
            
            // Test 3: Try standard audio session
            const sessions = await audioCapture.getAudioSessions();
            const wmpSession = sessions.find(s => s.processId === wmp.processId);
            if (wmpSession) {
                console.log('\n3. Testing with audio session...');
                console.log(`   Session ID: ${wmpSession.sessionId}`);
                try {
                    const result = await audioCapture.startCapture(wmpSession.sessionId);
                    console.log('   Result:', result);
                    if (result.success) {
                        await audioCapture.stopCapture();
                        console.log('   ✓ Success!');
                    }
                } catch (err) {
                    console.log('   ✗ Failed:', err.message);
                }
            }
        } else {
            console.log('Windows Media Player not found');
        }
        
        // 5. System info
        console.log('\n\nSystem Information:');
        console.log('==================');
        const os = require('os');
        console.log(`Windows Version: ${os.release()}`);
        console.log(`Build: ${os.version()}`);
        console.log(`Architecture: ${os.arch()}`);
        
        // Check Windows Audio service
        exec('sc query AudioSrv', (err, stdout) => {
            if (!err && stdout.includes('RUNNING')) {
                console.log('Windows Audio Service: RUNNING');
            } else {
                console.log('Windows Audio Service: NOT RUNNING or ERROR');
            }
            
            console.log('\n=== Diagnostics Complete ===');
        });
    });
}

runDiagnostics().catch(console.error);