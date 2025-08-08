// Basic test of the audio capture module
const audioCapture = require('../../native-modules/window-audio-capture');

console.log('Testing window-audio-capture module...');
console.log('Module:', audioCapture);
console.log('Methods:', Object.keys(audioCapture));

// Test getWindowList
console.log('\nTesting getWindowList...');
try {
    const windows = audioCapture.getWindowList();
    console.log('Windows:', windows ? windows.length : 'null');
} catch (e) {
    console.error('Error:', e.message);
}

// Test getAudioSessions
console.log('\nTesting getAudioSessions...');
try {
    const sessions = audioCapture.getAudioSessions();
    console.log('Sessions:', sessions ? sessions.length : 'null');
} catch (e) {
    console.error('Error:', e.message);
}

console.log('\nTest complete');
process.exit(0);