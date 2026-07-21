param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("install", "uninstall")]
  [string]$Mode,

  [string]$InstallDir = "",
  [string]$Selected = "0"
)

$ErrorActionPreference = "Stop"
$regKey = "HKCU:\Software\ElectronCapture"

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ElectronCaptureEnvironmentBroadcast {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
  public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd,
    uint Msg,
    UIntPtr wParam,
    string lParam,
    uint fuFlags,
    uint uTimeout,
    out UIntPtr lpdwResult
  );
}
"@

function Normalize-PathEntry([string]$value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return $null }
  $trimmed = $value.Trim()
  if ($trimmed -match '^[A-Za-z]:\\$') { return $trimmed }
  while ($trimmed.Length -gt 3 -and $trimmed.EndsWith("\")) {
    $trimmed = $trimmed.Substring(0, $trimmed.Length - 1)
  }
  return $trimmed
}

function Get-UniquePathEntries([string]$pathValue) {
  $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  $entries = [System.Collections.Generic.List[string]]::new()
  foreach ($rawEntry in ($pathValue -split ";")) {
    $entry = Normalize-PathEntry $rawEntry
    if (-not $entry) { continue }
    if ($seen.Add($entry)) {
      [void]$entries.Add($entry)
    }
  }
  return ,$entries
}

function Remove-Entry([System.Collections.Generic.List[string]]$entries, [string]$value) {
  $target = Normalize-PathEntry $value
  if (-not $target) { return }
  for ($index = $entries.Count - 1; $index -ge 0; $index--) {
    if ([string]::Equals($entries[$index], $target, [System.StringComparison]::OrdinalIgnoreCase)) {
      $entries.RemoveAt($index)
    }
  }
}

function Add-Entry([System.Collections.Generic.List[string]]$entries, [string]$value) {
  $target = Normalize-PathEntry $value
  if (-not $target) { return }
  foreach ($entry in $entries) {
    if ([string]::Equals($entry, $target, [System.StringComparison]::OrdinalIgnoreCase)) {
      return
    }
  }
  [void]$entries.Add($target)
}

function Write-UserPath([System.Collections.Generic.List[string]]$entries) {
  if ($entries.Count -eq 0) {
    [Environment]::SetEnvironmentVariable("Path", $null, "User")
    return
  }
  [Environment]::SetEnvironmentVariable("Path", ($entries -join ";"), "User")
}

function Broadcast-EnvironmentChange {
  $result = [UIntPtr]::Zero
  [void][ElectronCaptureEnvironmentBroadcast]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, "Environment", 0x0002, 5000, [ref]$result)
}

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$entries = Get-UniquePathEntries $userPath
$storedPath = (Get-ItemProperty -Path $regKey -Name PathEntry -ErrorAction SilentlyContinue).PathEntry

# Remove entries previously managed by this installer and any legacy entry for the current install directory.
Remove-Entry $entries $storedPath
Remove-Entry $entries $InstallDir

if ($Mode -eq "uninstall") {
  Write-UserPath $entries
  if (Test-Path $regKey) {
    Remove-ItemProperty -Path $regKey -Name PathEntry -ErrorAction SilentlyContinue
  }
  Broadcast-EnvironmentChange
  exit 0
}

if ($Selected -eq "1") {
  Add-Entry $entries $InstallDir
  if (-not (Test-Path $regKey)) {
    New-Item -Path $regKey -Force | Out-Null
  }
  New-ItemProperty -Path $regKey -Name PathEntry -Value (Normalize-PathEntry $InstallDir) -PropertyType String -Force | Out-Null
} elseif (Test-Path $regKey) {
  Remove-ItemProperty -Path $regKey -Name PathEntry -ErrorAction SilentlyContinue
}

Write-UserPath $entries
Broadcast-EnvironmentChange
