#!/bin/bash

# Audio Capture Test Runner
# Runs the window audio capture test with admin privileges from WSL

set -e

echo "=== Window Audio Capture Automated Test ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the Windows path for this directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
WIN_DIR=$(wslpath -w "$SCRIPT_DIR")

# Function to check if running in WSL
check_wsl() {
    if ! grep -q Microsoft /proc/version; then
        echo -e "${RED}Error: This script must be run from WSL${NC}"
        exit 1
    fi
}

# Function to run command as Windows admin
run_as_admin() {
    local cmd="$1"
    echo -e "${YELLOW}Requesting administrator privileges...${NC}"
    echo "A UAC prompt will appear - please approve it."
    echo ""
    
    # Create a temporary batch file to run our command
    local temp_bat="/tmp/run_admin_$$.bat"
    cat > "$temp_bat" << EOF
@echo off
cd /d "$WIN_DIR"
$cmd
echo.
echo Exit code: %errorlevel%
pause
EOF
    
    # Convert to Windows path
    local win_bat=$(wslpath -w "$temp_bat")
    
    # Run with PowerShell to request elevation
    powershell.exe -Command "Start-Process cmd -ArgumentList '/c \"$win_bat\"' -Verb RunAs -Wait"
    local result=$?
    
    # Cleanup
    rm -f "$temp_bat"
    
    return $result
}

# Main execution
main() {
    echo "Checking environment..."
    check_wsl
    
    # Check if Node.js is available in Windows
    if ! cmd.exe /c "node --version" &>/dev/null; then
        echo -e "${RED}Error: Node.js is not installed on Windows${NC}"
        echo "Please install Node.js from https://nodejs.org/"
        exit 1
    fi
    
    # Check if test files exist
    if [ ! -f "$SCRIPT_DIR/test-with-vlc.js" ]; then
        echo -e "${RED}Error: Test files not found${NC}"
        echo "Current directory: $SCRIPT_DIR"
        exit 1
    fi
    
    # Generate test tone if needed
    if [ ! -f "$SCRIPT_DIR/test-tone-440hz.wav" ]; then
        echo "Generating test tone..."
        cmd.exe /c "node generate-test-tone.js"
    fi
    
    echo ""
    echo -e "${GREEN}Starting audio capture test...${NC}"
    echo "This will:"
    echo "  1. Play a 440Hz test tone"
    echo "  2. Capture audio using the native module"
    echo "  3. Verify the captured audio"
    echo ""
    
    # Run the test with admin privileges
    run_as_admin "node test-with-vlc.js"
    
    echo ""
    echo "Test completed. Check the admin window for results."
    
    # Check if output files were created
    if [ -f "$SCRIPT_DIR/captured-media.wav" ]; then
        echo ""
        echo -e "${GREEN}Success! Audio was captured.${NC}"
        echo "Output file: $WIN_DIR\\captured-media.wav"
        echo ""
        echo "To play the captured audio:"
        echo "  cmd.exe /c \"start $WIN_DIR\\captured-media.wav\""
    else
        echo ""
        echo -e "${YELLOW}No captured audio file found.${NC}"
        echo "The test may have failed - check the output above."
    fi
}

# Run main function
main "$@"