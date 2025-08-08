# Window Audio Capture Test Runner
# PowerShell script to run the audio capture test

Write-Host "=== Window Audio Capture Test Runner ===" -ForegroundColor Cyan
Write-Host ""

# Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Check prerequisites
Write-Host "1. Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = node --version 2>$null
    if ($nodeVersion) {
        Write-Host "   ✓ Node.js $nodeVersion is available" -ForegroundColor Green
    } else {
        throw "Node.js not found"
    }
} catch {
    Write-Host "   ✗ Error: Node.js is not installed or not in PATH" -ForegroundColor Red
    exit 1
}

# Check native module
$nativeModulePath = Join-Path $scriptDir "..\..\native-modules\window-audio-capture\index.js"
if (Test-Path $nativeModulePath) {
    Write-Host "   ✓ Native module found" -ForegroundColor Green
} else {
    Write-Host "   ✗ Error: window-audio-capture module not found" -ForegroundColor Red
    Write-Host "     Please ensure the native module is built" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "2. Running the audio capture test..." -ForegroundColor Yellow
Write-Host ""

# Change to test directory
Push-Location $scriptDir

try {
    # Run the test
    $process = Start-Process -FilePath "node" -ArgumentList "test-capture-fft.js" -PassThru -Wait -NoNewWindow
    $exitCode = $process.ExitCode
    
    Write-Host ""
    if ($exitCode -eq 0) {
        Write-Host "=== TEST SUITE PASSED ===" -ForegroundColor Green
        
        # Check for output files
        if (Test-Path "captured-audio.wav") {
            Write-Host ""
            Write-Host "Audio files created:" -ForegroundColor Cyan
            Write-Host "  - captured-audio.raw (raw float32 PCM)"
            Write-Host "  - captured-audio.wav (playable WAV file)"
            Write-Host ""
            Write-Host "You can play the captured audio with:" -ForegroundColor Yellow
            Write-Host "  Start-Process 'captured-audio.wav'"
        }
    } else {
        Write-Host "=== TEST SUITE FAILED ===" -ForegroundColor Red
        Write-Host "Check the output above for details" -ForegroundColor Red
    }
    
    exit $exitCode
} finally {
    Pop-Location
}