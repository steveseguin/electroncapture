#!/usr/bin/env python3
"""
Simple tone generator for Windows using pyaudio
Generates a 440Hz sine wave for testing audio capture
"""

import numpy as np
import time
import sys

try:
    import pyaudio
except ImportError:
    print("Error: pyaudio not installed")
    print("Install with: pip install pyaudio")
    sys.exit(1)

def generate_tone(frequency=440, duration=3, sample_rate=44100):
    """Generate a sine wave tone"""
    samples = int(sample_rate * duration)
    wave = np.sin(2 * np.pi * frequency * np.arange(samples) / sample_rate)
    # Convert to 16-bit PCM
    wave = (wave * 32767).astype(np.int16)
    return wave

def play_tone(frequency=440, duration=3):
    """Play a tone using PyAudio"""
    print(f"=== Python Tone Generator ===")
    print(f"Frequency: {frequency} Hz")
    print(f"Duration: {duration} seconds")
    print()
    
    # Initialize PyAudio
    p = pyaudio.PyAudio()
    
    # Generate tone
    sample_rate = 44100
    tone = generate_tone(frequency, duration, sample_rate)
    
    # Open stream
    stream = p.open(
        format=pyaudio.paInt16,
        channels=1,
        rate=sample_rate,
        output=True
    )
    
    print("Playing tone...")
    
    # Play tone
    stream.write(tone.tobytes())
    
    # Cleanup
    stream.stop_stream()
    stream.close()
    p.terminate()
    
    print("Tone finished.")

if __name__ == "__main__":
    # Check if custom parameters provided
    freq = 440
    dur = 3
    
    if len(sys.argv) > 1:
        freq = int(sys.argv[1])
    if len(sys.argv) > 2:
        dur = float(sys.argv[2])
    
    play_tone(freq, dur)