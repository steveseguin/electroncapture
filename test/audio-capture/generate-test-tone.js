// Generate a 440Hz test tone WAV file
const fs = require('fs');
const path = require('path');

function generateWAV(frequency, duration, sampleRate = 44100) {
    const numSamples = sampleRate * duration;
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const dataSize = numSamples * blockAlign;
    
    // Create buffer for entire WAV file
    const buffer = Buffer.alloc(44 + dataSize);
    
    // Write WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // audio format (1 = PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    
    // Generate sine wave
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const value = Math.sin(2 * Math.PI * frequency * t);
        const sample = Math.floor(value * 32767);
        buffer.writeInt16LE(sample, offset);
        offset += 2;
    }
    
    return buffer;
}

// Generate 440Hz tone for 3 seconds
const frequency = 440;
const duration = 3;
const wavBuffer = generateWAV(frequency, duration);

// Save to file
const outputPath = path.join(__dirname, 'test-tone-440hz.wav');
fs.writeFileSync(outputPath, wavBuffer);

console.log(`Generated ${outputPath}`);
console.log(`Frequency: ${frequency} Hz`);
console.log(`Duration: ${duration} seconds`);