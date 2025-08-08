# Window Audio Capture Test Suite Summary

## Overview
This test suite validates the `window-audio-capture` native module by playing a 440Hz tone and capturing it to verify the audio is recorded correctly and without distortion.

## Test Components

### 1. Test Tone Generation (`generate-test-tone.js`)
- Creates a 440Hz sine wave WAV file (3 seconds duration)
- 44.1kHz sample rate, 16-bit PCM format
- Output: `test-tone-440hz.wav`

### 2. Audio Capture Test (`test-capture-wav.js`)
- Plays the WAV file using Windows Media Player
- Captures audio using the native module
- Analyzes captured audio for frequency accuracy
- Validates that the captured audio contains a 440Hz tone

### 3. Frequency Analysis
- Uses Discrete Fourier Transform (DFT) to find dominant frequency
- Tolerance: ±10Hz from expected 440Hz
- Takes multiple samples throughout recording for accuracy

## Running the Test

### Prerequisites
- Windows 10 Build 18362+ (version 1903 or later)
- Node.js installed
- **Administrator privileges** (required for audio loopback)
- Native module built (`window-audio-capture.node`)

### Execution
```batch
# Right-click and "Run as administrator"
test-runner.bat
```

Or from an elevated command prompt:
```batch
node test-capture-wav.js
```

### From WSL
```bash
# Will prompt for admin elevation
cmd.exe /c "cd C:\\path\\to\\test && test-runner.bat"
```

## Expected Results

### Success Criteria
- Audio is captured successfully
- RMS level > 0.01 (indicates audio present)
- Dominant frequency: 440Hz ±10Hz
- Test outputs: `captured-audio.wav` (playable audio file)

### Sample Output (Success)
```
=== Test Results ===
Audio captured: YES
RMS Level: 0.1234
Dominant frequency: 441.2 Hz
Expected frequency: 440 Hz
Frequency error: 1.2 Hz
Frequency match: PASS

✅ TEST PASSED: Successfully captured 440Hz tone
```

## Troubleshooting

### Common Issues

1. **"Failed to create process-specific loopback capture"**
   - Solution: Run as administrator

2. **"No audio sessions found"**
   - Ensure Windows Media Player is installed
   - Check Windows audio service is running

3. **"Frequency does not match expected"**
   - Verify system audio is not muted
   - Close other audio applications
   - Check `captured-audio.wav` manually

## Technical Details

### Audio Capture Methods Attempted
1. Process-specific streaming capture (preferred)
2. Window handle streaming capture
3. Audio session polling capture (fallback)

### Frequency Analysis Method
- DFT focused on 400-480Hz range
- Multiple samples analyzed throughout recording
- Median frequency used to reduce noise impact

## Files Generated
- `test-tone-440hz.wav` - Source audio (440Hz tone)
- `captured-audio.raw` - Raw float32 PCM capture
- `captured-audio.wav` - Captured audio in playable format

## Automation
This test can be run automatically in CI/CD pipelines with admin privileges. Exit codes:
- 0: Test passed
- 1: Test failed

The test is designed to be self-contained and require no user interaction beyond initial execution.