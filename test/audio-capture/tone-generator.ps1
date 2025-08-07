# PowerShell Tone Generator
# Generates a 440Hz tone using .NET System.Console.Beep

param(
    [int]$Frequency = 440,
    [int]$Duration = 3000
)

Write-Host "PowerShell Tone Generator"
Write-Host "Frequency: $Frequency Hz"
Write-Host "Duration: $($Duration/1000) seconds"
Write-Host ""
Write-Host "Playing tone..."

# Use Console.Beep to generate the tone
[Console]::Beep($Frequency, $Duration)

Write-Host "Tone finished."