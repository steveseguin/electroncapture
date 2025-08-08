// Diagnostic script for window-audio-capture module

console.log('=== Window Audio Capture Module Diagnostics ===\n');

// Try to load the module
let audioCapture;
try {
    audioCapture = require('../../native-modules/window-audio-capture');
    console.log('✓ Module loaded successfully');
} catch (err) {
    console.error('✗ Failed to load module:', err.message);
    process.exit(1);
}

// Check module structure
console.log('\nModule structure:');
console.log('Type:', typeof audioCapture);
console.log('Keys:', Object.keys(audioCapture));

// Check methods
const methods = [
    'getWindowList',
    'getAudioSessions', 
    'startCapture',
    'stopCapture',
    'getAudioData',
    'startStreamCapture',
    'stopStreamCapture'
];

console.log('\nMethod availability:');
methods.forEach(method => {
    const available = typeof audioCapture[method] === 'function';
    console.log(`${method}: ${available ? '✓' : '✗'}`);
});

// Test basic functionality
async function runDiagnostics() {
    console.log('\n--- Testing getWindowList ---');
    try {
        const windows = await audioCapture.getWindowList();
        console.log(`✓ Retrieved ${windows.length} windows`);
        if (windows.length > 0) {
            console.log('Sample window:', {
                title: windows[0].title?.substring(0, 50) + '...',
                executableName: windows[0].executableName,
                processId: windows[0].processId,
                id: windows[0].id
            });
        }
    } catch (err) {
        console.error('✗ getWindowList failed:', err.message);
    }

    console.log('\n--- Testing getAudioSessions ---');
    try {
        const sessions = await audioCapture.getAudioSessions();
        console.log(`✓ Retrieved ${sessions.length} audio sessions`);
        if (sessions.length > 0) {
            console.log('Active sessions:');
            sessions.forEach((session, i) => {
                if (session.isActive) {
                    console.log(`  Session ${i}: Process ${session.processId}, Active: ${session.isActive}`);
                }
            });
        }
    } catch (err) {
        console.error('✗ getAudioSessions failed:', err.message);
    }

    console.log('\n--- Testing audio capture (non-destructive) ---');
    try {
        // Just check if we can get audio data without starting capture
        const data = audioCapture.getAudioData();
        console.log(`✓ getAudioData returned: ${typeof data} with ${data?.length || 0} samples`);
    } catch (err) {
        console.error('✗ getAudioData failed:', err.message);
    }

    // Check Windows version
    const os = require('os');
    console.log('\n--- System Information ---');
    console.log('Platform:', os.platform());
    console.log('Release:', os.release());
    console.log('Architecture:', os.arch());
    
    // Check if running as admin
    const { exec } = require('child_process');
    exec('net session', (error) => {
        console.log('Administrator privileges:', error ? 'NO' : 'YES');
        
        if (error) {
            console.log('\n⚠️  Many audio capture features require administrator privileges');
        }
    });
}

runDiagnostics().catch(err => {
    console.error('\nDiagnostics failed:', err);
});