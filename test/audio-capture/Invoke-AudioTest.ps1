# Automated Window Audio Capture Test
# PowerShell script with full automation and admin handling

param(
    [switch]$SkipAdminCheck
)

# Check if running as admin
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Elevate to admin if needed
if (-not (Test-Administrator) -and -not $SkipAdminCheck) {
    Write-Host "Requesting administrator privileges..." -ForegroundColor Yellow
    $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Start-Process powershell -Verb RunAs -ArgumentList $arguments
    exit
}

Write-Host "=== Window Audio Capture Automated Test ===" -ForegroundColor Cyan
Write-Host ""

# Set working directory
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Step 1: Check prerequisites
Write-Host "Step 1: Checking prerequisites..." -ForegroundColor Yellow

# Check Node.js
try {
    $nodeVersion = & node --version 2>$null
    Write-Host "  [OK] Node.js $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  [ERROR] Node.js not found" -ForegroundColor Red
    Write-Host "  Please install Node.js from https://nodejs.org/" -ForegroundColor Red
    pause
    exit 1
}

# Check native module
$nativeModule = Join-Path (Split-Path -Parent (Split-Path -Parent $scriptPath)) "native-modules\window-audio-capture\index.js"
if (Test-Path $nativeModule) {
    Write-Host "  [OK] Native module found" -ForegroundColor Green
} else {
    Write-Host "  [ERROR] Native module not found" -ForegroundColor Red
    pause
    exit 1
}

# Step 2: Generate test tone
Write-Host ""
Write-Host "Step 2: Preparing test audio..." -ForegroundColor Yellow

if (-not (Test-Path "test-tone-440hz.wav")) {
    Write-Host "  Generating 440Hz test tone..."
    & node generate-test-tone.js
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [ERROR] Failed to generate test tone" -ForegroundColor Red
        pause
        exit 1
    }
    Write-Host "  [OK] Test tone generated" -ForegroundColor Green
} else {
    Write-Host "  [OK] Test tone already exists" -ForegroundColor Green
}

# Step 3: Run the test
Write-Host ""
Write-Host "Step 3: Running audio capture test..." -ForegroundColor Yellow
Write-Host ""

# Capture output
$testOutput = & node test-with-vlc.js 2>&1 | Out-String
$testExitCode = $LASTEXITCODE

# Display output
Write-Host $testOutput

# Step 4: Analyze results
Write-Host ""
Write-Host "Step 4: Analyzing results..." -ForegroundColor Yellow

$captured = Test-Path "captured-media.wav"
$success = $testExitCode -eq 0 -and $captured

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
if ($success) {
    Write-Host "         TEST PASSED" -ForegroundColor Green
    Write-Host "=======================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Audio successfully captured!" -ForegroundColor Green
    
    # Get file info
    $fileInfo = Get-Item "captured-media.wav"
    Write-Host "Output file: $($fileInfo.FullName)"
    Write-Host "File size: $([math]::Round($fileInfo.Length / 1KB, 2)) KB"
    
    # Play the captured audio
    Write-Host ""
    $response = Read-Host "Play captured audio? (Y/N)"
    if ($response -eq 'Y') {
        Start-Process "captured-media.wav"
    }
} else {
    Write-Host "         TEST FAILED" -ForegroundColor Red
    Write-Host "=======================================" -ForegroundColor Cyan
    Write-Host ""
    
    # Diagnose common issues
    if ($testOutput -match "0x8000000e") {
        Write-Host "Error: E_OUTOFMEMORY during audio capture" -ForegroundColor Red
        Write-Host "This is a known Windows limitation with process-specific capture." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Suggestions:" -ForegroundColor Yellow
        Write-Host "  1. Try using VLC media player instead of Windows Media Player"
        Write-Host "  2. The native module may need modification to use default audio capture"
        Write-Host "  3. Check if the audio process is using exclusive mode"
    } elseif ($testOutput -match "No audio captured") {
        Write-Host "Error: No audio data was captured" -ForegroundColor Red
        Write-Host ""
        Write-Host "Possible causes:" -ForegroundColor Yellow
        Write-Host "  - Media player is muted"
        Write-Host "  - Audio is not playing through default device"
        Write-Host "  - Process doesn't create standard audio session"
    }
}

Write-Host ""
Write-Host "Test log saved to: test-results.txt"

# Save detailed results
$testOutput | Out-File -FilePath "test-results.txt"

Write-Host ""
pause