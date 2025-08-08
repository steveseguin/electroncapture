@echo off
setlocal EnableDelayedExpansion

:: Window Audio Capture Automated Test
:: This script runs the complete test suite with admin privileges

echo ===============================================
echo  Window Audio Capture Automated Test Suite
echo ===============================================
echo.

:: Check for admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo Running with administrator privileges
echo.

cd /d "%~dp0"

:: Step 1: Generate test tone if needed
if not exist "test-tone-440hz.wav" (
    echo Step 1: Generating test tone...
    node generate-test-tone.js
    if errorlevel 1 (
        echo ERROR: Failed to generate test tone
        pause
        exit /b 1
    )
    echo Test tone generated successfully
) else (
    echo Step 1: Test tone already exists
)

echo.
echo Step 2: Running audio capture test...
echo.

:: Run the actual test and capture output
node test-with-vlc.js > test-results.txt 2>&1
set TEST_RESULT=%errorlevel%

:: Also check if the output file was created
set OUTPUT_EXISTS=0
if exist "captured-media.wav" set OUTPUT_EXISTS=1

:: Display the output
type test-results.txt

echo.
echo ===============================================

:: Check results - test passes only if we captured audio
if %OUTPUT_EXISTS% equ 1 (
    echo TEST STATUS: PASSED
    echo.
    echo Captured audio saved to: captured-media.wav
    echo Playing captured audio...
    start "" "captured-media.wav"
) else (
    echo TEST STATUS: FAILED
    echo.
    echo No audio was captured. Common issues:
    echo - Process-specific loopback failing with E_OUTOFMEMORY (0x8000000e)
    echo - Windows Media Player may not create capturable audio session
    echo - Native module needs modification to support default audio loopback
    echo.
    echo Even with admin privileges, Windows is unable to create
    echo process-specific audio loopback for this application.
)

echo ===============================================
echo.
echo Test log saved to: test-results.txt
echo.
pause