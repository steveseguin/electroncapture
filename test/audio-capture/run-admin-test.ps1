# PowerShell script to run test with admin privileges

$testPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$testScript = Join-Path $testPath "test-capture-wav.js"
$logFile = Join-Path $testPath "test-output.log"

Write-Host "Requesting administrator privileges..." -ForegroundColor Yellow

# Create a script block to run as admin
$adminScript = @"
Set-Location '$testPath'
& node '$testScript' > '$logFile' 2>&1
"@

# Start new PowerShell process as admin
try {
    Start-Process powershell -ArgumentList "-NoProfile", "-Command", $adminScript -Verb RunAs -Wait
    
    Write-Host "`nTest completed. Checking results..." -ForegroundColor Green
    
    # Read and display the log
    if (Test-Path $logFile) {
        Write-Host "`n=== Test Output ===" -ForegroundColor Cyan
        Get-Content $logFile
        
        # Check if output files were created
        if (Test-Path "captured-audio.wav") {
            Write-Host "`n[OK] Captured audio file created successfully!" -ForegroundColor Green
        }
    } else {
        Write-Host "No log file found. Test may have failed to run." -ForegroundColor Red
    }
} catch {
    Write-Host "Failed to start admin process: $($_.Exception.Message)" -ForegroundColor Red
}