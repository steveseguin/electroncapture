#!/usr/bin/env python3
"""
Simple 440Hz tone player using Windows Audio APIs via pywin32
No external audio libraries required - uses Windows directly
"""

import sys
import time
import math
import struct

try:
    import win32com.client
    import pythoncom
except ImportError:
    print("This script requires pywin32")
    print("Install with: pip install pywin32")
    sys.exit(1)

def generate_sine_wave(frequency=440, duration=3, sample_rate=44100):
    """Generate sine wave samples"""
    samples = []
    num_samples = int(sample_rate * duration)
    
    for i in range(num_samples):
        t = float(i) / sample_rate
        value = math.sin(2.0 * math.pi * frequency * t)
        # Convert to 16-bit signed integer
        sample = int(value * 32767.0)
        samples.append(sample)
    
    return samples

def play_with_windows_media():
    """Play tone using Windows Media Player COM object"""
    print("Playing 440Hz tone using Windows Media Player...")
    
    # First, create a temporary WAV file
    import tempfile
    import os
    
    # Generate samples
    samples = generate_sine_wave(440, 3)
    
    # Create WAV file
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
        wav_path = f.name
        
        # WAV header
        f.write(b'RIFF')
        f.write(struct.pack('<L', 36 + len(samples) * 2))
        f.write(b'WAVE')
        f.write(b'fmt ')
        f.write(struct.pack('<L', 16))  # fmt chunk size
        f.write(struct.pack('<H', 1))   # PCM
        f.write(struct.pack('<H', 1))   # channels
        f.write(struct.pack('<L', 44100))  # sample rate
        f.write(struct.pack('<L', 44100 * 2))  # byte rate
        f.write(struct.pack('<H', 2))   # block align
        f.write(struct.pack('<H', 16))  # bits per sample
        f.write(b'data')
        f.write(struct.pack('<L', len(samples) * 2))
        
        # Write samples
        for sample in samples:
            f.write(struct.pack('<h', sample))
    
    # Play using Windows Media Player
    try:
        pythoncom.CoInitialize()
        player = win32com.client.Dispatch("WMPlayer.OCX")
        player.URL = wav_path
        player.controls.play()
        
        # Wait for playback
        time.sleep(4)
        
        player.close()
    finally:
        pythoncom.CoUninitialize()
        # Clean up temp file
        try:
            os.unlink(wav_path)
        except:
            pass

def play_with_winsound():
    """Alternative: Use winsound module"""
    try:
        import winsound
        print("Playing 440Hz tone using winsound.Beep...")
        winsound.Beep(440, 3000)  # 440Hz for 3 seconds
    except Exception as e:
        print(f"Winsound failed: {e}")
        return False
    return True

if __name__ == "__main__":
    print("=== Windows Tone Player ===")
    print("Frequency: 440 Hz")
    print("Duration: 3 seconds")
    print()
    
    # Try winsound first (simpler)
    if not play_with_winsound():
        # Fall back to Windows Media Player
        try:
            play_with_windows_media()
        except Exception as e:
            print(f"Error: {e}")
            print("\nFailed to play audio")
            sys.exit(1)
    
    print("\nTone playback completed")