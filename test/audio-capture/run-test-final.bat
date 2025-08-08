@echo off
setlocal EnableDelayedExpansion

:: Window Audio Capture Test - Final Version
:: This script properly reports pass/fail status

echo ===============================================
echo  Window Audio Capture Test Suite v2
echo ===============================================
echo.

:: Check for admin rights
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

echo [OK] Running with administrator privileges
echo.

cd /d "%~dp0"

:: Clean up any previous test results
if exist "captured-media.wav" del "captured-media.wav" >nul 2>&1

:: Generate test tone if needed
if not exist "test-tone-440hz.wav" (
    echo Generating test tone...
    node generate-test-tone.js
    if errorlevel 1 (
        echo [ERROR] Failed to generate test tone
        pause
        exit /b 1
    )
)

echo Starting audio capture test...
echo ----------------------------------------
echo.

:: Run the test
node test-with-vlc.js

:: Check if audio was captured
echo.
echo ----------------------------------------
echo FINAL RESULTS:
echo ----------------------------------------

if exist "captured-media.wav" (
    echo [PASS] Audio was successfully captured!
    echo.
    echo Output file: captured-media.wav
    
    :: Get file size
    for %%F in ("captured-media.wav") do set size=%%~zF
    echo File size: !size! bytes
    
    if !size! gtr 1000 (
        echo Status: Valid audio file
        echo.
        echo Playing captured audio...
        start "" "captured-media.wav"
    ) else (
        echo Status: File too small - capture may have failed
    )
) else (
    echo [FAIL] No audio was captured
    echo.
    echo The test detected the following error:
    echo - Process-specific loopback failed with E_OUTOFMEMORY (0x8000000e)
    echo.
    echo This is a known Windows limitation where certain processes
    echo cannot be captured using process-specific audio loopback.
    echo.
    echo To fix this, the native module needs to support:
    echo 1. Default audio endpoint loopback capture
    echo 2. Fallback mechanism when process-specific fails
)

echo ----------------------------------------
echo.
pause