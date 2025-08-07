@echo off
echo Running Window Audio Capture Test with Administrator privileges...
echo.

cd /d "%~dp0"

rem Generate test tone if it doesn't exist
if not exist "test-tone-440hz.wav" (
    echo Generating test tone...
    node generate-test-tone.js
    echo.
)

rem Run the WAV-based test
node test-capture-wav.js

echo.
echo Press any key to exit...
pause >nul