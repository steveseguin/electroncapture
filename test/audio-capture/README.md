# Window Audio Capture Test Suite

This test suite validates the window-audio-capture native module by:
1. Playing a pre-generated 440Hz WAV file using Windows Media Player
2. Capturing audio from the media player using the native module
3. Analyzing the captured audio to verify it contains a 440Hz sine wave

## Prerequisites

- Windows 10 version 1903 or later (Build 18362+)
- Node.js installed on Windows
- The native module must be built (`npm run build` in native-modules/window-audio-capture)
- **Administrator privileges** (required for process-specific audio loopback)

## Running the Test

### From Windows (Recommended)

1. **With Administrator privileges:**
   - Right-click on `run-test-admin.bat` and select "Run as administrator"
   - Or open an admin command prompt and run: `node test-capture-fft.js`

2. **From PowerShell (with admin):**
   ```powershell
   # Run as administrator
   powershell -ExecutionPolicy Bypass -File run-test.ps1
   ```

### From WSL

```bash
# Run the test via cmd.exe
cd /mnt/c/Users/steve/Code/electroncapture/test/audio-capture
cmd.exe /c "node test-capture-fft.js"

# Note: You'll need to approve the UAC prompt for admin access
```

## Test Process

1. **Test Tone Generation**: Creates a 440Hz WAV file if it doesn't exist
   - Pure 440Hz sine wave, 3 seconds duration
   - 44.1kHz sample rate, 16-bit PCM

2. **Audio Playback**: Launches Windows Media Player to play the WAV file
   - Uses the default Windows audio output
   - No user interaction required (unlike browsers)

3. **Audio Capture**: Records audio from Windows Media Player for 4 seconds
   - Uses Windows Audio Session API (WASAPI)
   - Requires admin privileges for process-specific loopback

4. **Frequency Analysis**: Analyzes the captured audio
   - Performs Discrete Fourier Transform (DFT) on samples
   - Finds the dominant frequency
   - Verifies it matches 440Hz (±10Hz tolerance)

5. **Results**: Reports success/failure and saves audio files
   - `captured-audio.raw`: Raw float32 PCM data
   - `captured-audio.wav`: Playable WAV file

## Troubleshooting

### "Failed to create process-specific loopback capture"
- **Cause**: Insufficient privileges
- **Solution**: Run with administrator privileges

### "No audio was captured"
- **Causes**: 
  - Browser blocked autoplay
  - Audio not routed correctly
  - Browser muted in Windows
- **Solutions**:
  - Check browser autoplay settings
  - Ensure browser audio is not muted in Windows Volume Mixer
  - Try a different browser

### "Frequency does not match expected"
- **Causes**:
  - Audio distortion or interference
  - Sample rate mismatch
  - Capture timing issues
- **Solutions**:
  - Close other audio applications
  - Check the captured WAV file manually
  - Increase frequency tolerance in the test

## Manual Verification

To manually verify the captured audio:
```powershell
# Play the captured audio
Start-Process "captured-audio.wav"
```

You should hear a clear 440Hz tone (musical note A4).

## Test Configuration

Edit `test-capture-fft.js` to modify:
- `TARGET_FREQUENCY`: Expected frequency (default: 440Hz)
- `FREQUENCY_TOLERANCE`: Acceptable deviation (default: 10Hz)
- `CAPTURE_DURATION`: Recording duration (default: 4000ms)
- `FFT_SIZE`: Samples for frequency analysis (default: 8192)

## Implementation Notes

- Uses simplified DFT for frequency analysis (not full FFT)
- Focuses on 400-480Hz range for efficiency
- Takes multiple samples throughout recording for accuracy
- Calculates median frequency to reduce noise impact