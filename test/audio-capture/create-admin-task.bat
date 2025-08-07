@echo off
echo Creating scheduled task for audio capture test...

schtasks /create /tn "AudioCaptureTest" /tr "%cd%\test-runner.bat" /sc once /st 00:00 /rl highest /f

echo.
echo Task created. Running now...
schtasks /run /tn "AudioCaptureTest"

echo.
echo Waiting for test to complete...
timeout /t 10

echo.
echo Cleaning up task...
schtasks /delete /tn "AudioCaptureTest" /f

echo.
echo Check the output files:
echo   - captured-audio.wav
echo   - test-output.log
pause