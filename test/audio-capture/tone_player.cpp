// Simple Windows console app that plays a 440Hz tone
// Compile with: cl tone_player.cpp winmm.lib

#include <windows.h>
#include <mmsystem.h>
#include <iostream>
#include <cmath>
#include <vector>

#pragma comment(lib, "winmm.lib")

const int SAMPLE_RATE = 44100;
const int DURATION = 3; // seconds
const int FREQUENCY = 440; // Hz

void generateSineWave(std::vector<short>& buffer, int frequency, int duration) {
    int numSamples = SAMPLE_RATE * duration;
    buffer.resize(numSamples);
    
    for (int i = 0; i < numSamples; i++) {
        double t = (double)i / SAMPLE_RATE;
        double value = sin(2.0 * M_PI * frequency * t);
        buffer[i] = (short)(value * 32767);
    }
}

int main() {
    std::cout << "=== Windows Tone Player ===" << std::endl;
    std::cout << "Frequency: 440 Hz" << std::endl;
    std::cout << "Duration: 3 seconds" << std::endl;
    std::cout << std::endl;
    
    // Generate audio data
    std::vector<short> audioData;
    generateSineWave(audioData, FREQUENCY, DURATION);
    
    // Set up wave format
    WAVEFORMATEX waveFormat = {0};
    waveFormat.wFormatTag = WAVE_FORMAT_PCM;
    waveFormat.nChannels = 1;
    waveFormat.nSamplesPerSec = SAMPLE_RATE;
    waveFormat.wBitsPerSample = 16;
    waveFormat.nBlockAlign = waveFormat.nChannels * waveFormat.wBitsPerSample / 8;
    waveFormat.nAvgBytesPerSec = waveFormat.nSamplesPerSec * waveFormat.nBlockAlign;
    
    // Open wave output device
    HWAVEOUT hWaveOut;
    MMRESULT result = waveOutOpen(&hWaveOut, WAVE_MAPPER, &waveFormat, 0, 0, CALLBACK_NULL);
    
    if (result != MMSYSERR_NOERROR) {
        std::cerr << "Failed to open wave output device" << std::endl;
        return 1;
    }
    
    // Prepare header
    WAVEHDR waveHeader = {0};
    waveHeader.lpData = (LPSTR)audioData.data();
    waveHeader.dwBufferLength = audioData.size() * sizeof(short);
    
    result = waveOutPrepareHeader(hWaveOut, &waveHeader, sizeof(WAVEHDR));
    if (result != MMSYSERR_NOERROR) {
        std::cerr << "Failed to prepare wave header" << std::endl;
        waveOutClose(hWaveOut);
        return 1;
    }
    
    // Play the audio
    std::cout << "Playing tone..." << std::endl;
    result = waveOutWrite(hWaveOut, &waveHeader, sizeof(WAVEHDR));
    if (result != MMSYSERR_NOERROR) {
        std::cerr << "Failed to write audio data" << std::endl;
        waveOutUnprepareHeader(hWaveOut, &waveHeader, sizeof(WAVEHDR));
        waveOutClose(hWaveOut);
        return 1;
    }
    
    // Wait for playback to complete
    while (!(waveHeader.dwFlags & WHDR_DONE)) {
        Sleep(100);
    }
    
    std::cout << "Playback completed" << std::endl;
    
    // Cleanup
    waveOutUnprepareHeader(hWaveOut, &waveHeader, sizeof(WAVEHDR));
    waveOutClose(hWaveOut);
    
    return 0;
}