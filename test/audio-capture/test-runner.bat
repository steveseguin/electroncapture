@echo off
setlocal

:: Check for admin rights
net session >nul 2>&1
if %errorLevel% == 0 (
    echo Running with administrator privileges...
) else (
    echo This test requires administrator privileges.
    echo.
    echo Please run this batch file as administrator:
    echo 1. Right-click on test-runner.bat
    echo 2. Select "Run as administrator"
    echo.
    pause
    exit /b 1
)

echo ==============================================
echo Window Audio Capture Test Suite
echo ==============================================
echo.

cd /d "%~dp0"

:: Generate test tone if needed
if not exist "test-tone-440hz.wav" (
    echo Generating 440Hz test tone WAV file...
    node generate-test-tone.js
    if errorlevel 1 (
        echo Failed to generate test tone!
        pause
        exit /b 1
    )
    echo Test tone generated successfully.
    echo.
)

:: Run the test
echo Starting audio capture test...
echo.
node test-capture-wav.js

:: Capture exit code
set testResult=%errorLevel%

echo.
echo ==============================================
if %testResult% == 0 (
    echo TEST SUITE: PASSED
    echo.
    echo The window audio capture module is working correctly!
    echo Audio files saved:
    echo   - captured-audio.raw
    echo   - captured-audio.wav
) else (
    echo TEST SUITE: FAILED
    echo.
    echo Please check the error messages above.
)
echo ==============================================

echo.
pause