// Analyze existing WAV file for frequency content
const fs = require('fs');
const path = require('path');

function parseWAV(filePath) {
    const buffer = fs.readFileSync(filePath);
    
    // Parse WAV header
    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);
    
    if (riff !== 'RIFF' || wave !== 'WAVE') {
        throw new Error('Not a valid WAV file');
    }
    
    // Find data chunk
    let offset = 12;
    let dataOffset = 0;
    let dataSize = 0;
    let fmt = {};
    
    while (offset < buffer.length - 8) {
        const chunkId = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        
        if (chunkId === 'fmt ') {
            fmt.audioFormat = buffer.readUInt16LE(offset + 8);
            fmt.channels = buffer.readUInt16LE(offset + 10);
            fmt.sampleRate = buffer.readUInt32LE(offset + 12);
            fmt.bitsPerSample = buffer.readUInt16LE(offset + 22);
        } else if (chunkId === 'data') {
            dataOffset = offset + 8;
            dataSize = chunkSize;
            break;
        }
        
        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) offset++; // Padding
    }
    
    return {
        format: fmt,
        dataOffset,
        dataSize,
        buffer
    };
}

function analyzeFrequency(samples, sampleRate) {
    const fftSize = 8192; // Use larger FFT for better frequency resolution
    const freqResolution = sampleRate / fftSize;
    
    // Simple DFT for frequency analysis
    let maxMagnitude = 0;
    let dominantFreq = 0;
    
    // Focus on frequencies around 440Hz (400-480Hz)
    const startBin = Math.floor(400 / freqResolution);
    const endBin = Math.ceil(480 / freqResolution);
    
    console.log(`\nAnalyzing frequency bins ${startBin}-${endBin} (${400}Hz-${480}Hz)`);
    console.log(`Frequency resolution: ${freqResolution.toFixed(2)} Hz/bin`);
    
    for (let k = startBin; k <= endBin; k++) {
        let real = 0, imag = 0;
        const freq = k * freqResolution;
        
        for (let n = 0; n < Math.min(samples.length, fftSize); n++) {
            const angle = -2 * Math.PI * k * n / fftSize;
            real += samples[n] * Math.cos(angle);
            imag += samples[n] * Math.sin(angle);
        }
        
        const magnitude = Math.sqrt(real * real + imag * imag);
        
        if (magnitude > maxMagnitude) {
            maxMagnitude = magnitude;
            dominantFreq = freq;
        }
    }
    
    return dominantFreq;
}

// Main analysis
console.log('=== WAV File Frequency Analyzer ===\n');

const wavPath = process.argv[2] || 'captured-media.wav';
console.log(`Analyzing: ${wavPath}`);

try {
    const wav = parseWAV(wavPath);
    
    console.log('\nWAV Format:');
    console.log(`  Channels: ${wav.format.channels}`);
    console.log(`  Sample Rate: ${wav.format.sampleRate} Hz`);
    console.log(`  Bits Per Sample: ${wav.format.bitsPerSample}`);
    console.log(`  Audio Format: ${wav.format.audioFormat === 3 ? 'IEEE Float' : 'PCM'}`);
    
    // Extract samples
    const samples = [];
    const bytesPerSample = wav.format.bitsPerSample / 8;
    const numSamples = Math.min(wav.dataSize / bytesPerSample / wav.format.channels, 100000);
    
    console.log(`\nAnalyzing first ${numSamples} samples...`);
    
    for (let i = 0; i < numSamples; i++) {
        const offset = wav.dataOffset + (i * wav.format.channels * bytesPerSample);
        
        if (wav.format.audioFormat === 3) { // IEEE Float
            samples.push(wav.buffer.readFloatLE(offset));
        } else { // PCM
            if (wav.format.bitsPerSample === 16) {
                samples.push(wav.buffer.readInt16LE(offset) / 32768.0);
            } else if (wav.format.bitsPerSample === 32) {
                samples.push(wav.buffer.readInt32LE(offset) / 2147483648.0);
            }
        }
    }
    
    // Calculate RMS
    const rms = Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length);
    console.log(`\nRMS Level: ${rms.toFixed(4)}`);
    
    // Analyze frequency at different points in the file
    const segmentSize = Math.floor(samples.length / 5);
    console.log(`\nFrequency analysis at different time points:`);
    
    for (let i = 0; i < 5; i++) {
        const start = i * segmentSize;
        const segment = samples.slice(start, start + segmentSize);
        const freq = analyzeFrequency(segment, wav.format.sampleRate);
        const timeMs = Math.floor((start / wav.format.sampleRate) * 1000);
        console.log(`  ${timeMs}ms: ${freq.toFixed(1)} Hz`);
    }
    
    // Overall frequency
    const overallFreq = analyzeFrequency(samples, wav.format.sampleRate);
    console.log(`\nDominant Frequency: ${overallFreq.toFixed(1)} Hz`);
    console.log(`Expected: 440.0 Hz`);
    console.log(`Error: ${Math.abs(overallFreq - 440).toFixed(1)} Hz`);
    
    if (Math.abs(overallFreq - 440) < 5) {
        console.log('\n✅ SUCCESS: 440Hz tone detected!');
    } else {
        console.log('\n⚠️  Frequency does not match expected 440Hz');
    }
    
} catch (err) {
    console.error('Error:', err.message);
}