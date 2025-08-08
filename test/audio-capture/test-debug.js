// Debug test for audio capture module
console.log('Starting debug test...');

try {
    console.log('Loading module...');
    const audioCapture = require('../../native-modules/window-audio-capture');
    
    console.log('\nModule loaded:', typeof audioCapture);
    console.log('Is object:', audioCapture !== null && typeof audioCapture === 'object');
    
    // List all properties
    console.log('\nProperties:');
    for (let prop in audioCapture) {
        console.log(`  ${prop}: ${typeof audioCapture[prop]}`);
    }
    
    // Check if methods exist
    console.log('\nMethod checks:');
    console.log('  getWindowList:', typeof audioCapture.getWindowList);
    console.log('  getAudioSessions:', typeof audioCapture.getAudioSessions);
    console.log('  startCapture:', typeof audioCapture.startCapture);
    console.log('  stopCapture:', typeof audioCapture.stopCapture);
    console.log('  getAudioData:', typeof audioCapture.getAudioData);
    
    // Try calling getWindowList
    console.log('\nTrying getWindowList...');
    try {
        const result = audioCapture.getWindowList();
        console.log('Result type:', typeof result);
        console.log('Is array:', Array.isArray(result));
        console.log('Length:', result ? result.length : 'N/A');
        if (result && result.length > 0) {
            console.log('First window:', result[0]);
        }
    } catch (e) {
        console.error('Error calling getWindowList:', e);
    }
    
} catch (e) {
    console.error('Fatal error:', e);
}

console.log('\nDebug test complete');
process.exit(0);