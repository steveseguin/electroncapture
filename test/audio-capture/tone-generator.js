// Node.js tone generator using node-speaker
const Speaker = require('speaker');

// Generate a 440Hz sine wave
function generateTone(frequency, duration, sampleRate = 44100) {
    const numSamples = duration * sampleRate;
    const buffer = Buffer.alloc(numSamples * 2 * 2); // 16-bit stereo
    
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const sample = Math.sin(2 * Math.PI * frequency * t);
        const value = Math.floor(sample * 32767);
        
        // Write to both channels (stereo)
        buffer.writeInt16LE(value, i * 4);
        buffer.writeInt16LE(value, i * 4 + 2);
    }
    
    return buffer;
}

// Create speaker instance
const speaker = new Speaker({
    channels: 2,
    bitDepth: 16,
    sampleRate: 44100
});

console.log('440Hz Tone Generator');
console.log('Playing 440Hz tone for 3 seconds...');

// Generate and play tone
const toneBuffer = generateTone(440, 3);

speaker.on('open', () => {
    console.log('Audio device opened');
});

speaker.on('close', () => {
    console.log('Finished playing tone');
    process.exit(0);
});

// Write the tone to the speaker
speaker.write(toneBuffer);
speaker.end();