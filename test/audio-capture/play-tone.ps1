# PowerShell script to play a 440Hz tone using .NET

param(
    [int]$Frequency = 440,
    [int]$Duration = 3000
)

Write-Host "=== PowerShell Tone Player ==="
Write-Host "Frequency: $Frequency Hz"
Write-Host "Duration: $($Duration/1000) seconds"
Write-Host ""

# Method 1: Console.Beep (simple but works)
Write-Host "Playing tone using Console.Beep..."
[Console]::Beep($Frequency, $Duration)

Write-Host "Tone completed."

# Keep window open for a moment
Start-Sleep -Seconds 1