#!/bin/bash

# Audio Capture Test Runner
# This script runs the window audio capture test from WSL

echo "=== Window Audio Capture Test Runner ==="
echo ""

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WINDOWS_DIR=$(wslpath -w "$SCRIPT_DIR")

# Check if we're in WSL
if ! grep -q Microsoft /proc/version; then
    echo "Error: This script must be run from WSL"
    exit 1
fi

# Function to check if a process is running
is_running() {
    local process_name=$1
    tasklist.exe 2>/dev/null | grep -qi "$process_name"
}

# Function to kill a process
kill_process() {
    local process_name=$1
    taskkill.exe /F /IM "$process_name" 2>/dev/null
}

echo "1. Checking prerequisites..."

# Check if Node.js is available in Windows
if ! cmd.exe /c "node --version" 2>/dev/null; then
    echo "Error: Node.js is not installed or not in PATH on Windows"
    exit 1
fi

echo "   ✓ Node.js is available"

# Check if the native module exists
if [ ! -f "$SCRIPT_DIR/../../native-modules/window-audio-capture/index.js" ]; then
    echo "Error: window-audio-capture module not found"
    echo "Please ensure the native module is built"
    exit 1
fi

echo "   ✓ Native module found"

# Clean up any existing browser instances that might interfere
echo ""
echo "2. Cleaning up browser instances..."
# Don't kill all browsers, just close our test page if it's open
# This is handled by the test itself

echo ""
echo "3. Running the audio capture test..."
echo ""

# Change to the test directory
cd "$SCRIPT_DIR"

# Run the test using Windows Node.js
cmd.exe /c "cd $WINDOWS_DIR && node test-capture-fft.js"
TEST_RESULT=$?

echo ""
if [ $TEST_RESULT -eq 0 ]; then
    echo "=== TEST SUITE PASSED ==="
    
    # Check if output files were created
    if [ -f "$SCRIPT_DIR/captured-audio.wav" ]; then
        echo ""
        echo "Audio files created:"
        echo "  - captured-audio.raw (raw float32 PCM)"
        echo "  - captured-audio.wav (playable WAV file)"
        echo ""
        echo "You can play the captured audio with:"
        echo "  cmd.exe /c start $WINDOWS_DIR\\captured-audio.wav"
    fi
else
    echo "=== TEST SUITE FAILED ==="
    echo "Check the output above for details"
fi

exit $TEST_RESULT