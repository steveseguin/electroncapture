[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$FallbackInstaller,
    [Parameter(Mandatory = $true)]
    [string]$CurrentInstaller,
    [string]$InstallDirectory = (Join-Path $env:RUNNER_TEMP 'elecap-installer-roundtrip')
)

$ErrorActionPreference = 'Stop'

$fallbackPath = [System.IO.Path]::GetFullPath($FallbackInstaller)
$currentPath = [System.IO.Path]::GetFullPath($CurrentInstaller)
$installPath = [System.IO.Path]::GetFullPath($InstallDirectory)
$installedExecutable = Join-Path $installPath 'elecap.exe'
$uninstallRegistryRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$expectedRegistryKey = $null

foreach ($installer in @($fallbackPath, $currentPath)) {
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
        throw "Installer not found: $installer"
    }
}

if (Test-Path -LiteralPath $installPath) {
    $existingItems = @(Get-ChildItem -LiteralPath $installPath -Force)
    if ($existingItems.Count -ne 0) {
        throw "Test install directory is not empty: $installPath"
    }
    Remove-Item -LiteralPath $installPath -Force
}

function Get-ElecapUninstallEntries {
    if (-not (Test-Path -LiteralPath $uninstallRegistryRoot)) {
        return
    }
    @(Get-ChildItem -LiteralPath $uninstallRegistryRoot | ForEach-Object {
        $values = Get-ItemProperty -LiteralPath $_.PSPath
        if ($values.DisplayName -like 'elecap *') {
            [pscustomobject]@{
                KeyName = $_.PSChildName
                KeyPath = $_.PSPath
                Values = $values
            }
        }
    })
}

$preexistingEntries = @(Get-ElecapUninstallEntries)
if ($preexistingEntries.Count -ne 0) {
    throw 'An elecap current-user installation already exists; refusing to replace it during this test.'
}

function Assert-InstallerIdentity {
    $entries = @(Get-ElecapUninstallEntries)
    if ($entries.Count -ne 1) {
        throw "Expected exactly one elecap uninstall entry, found $($entries.Count)."
    }

    $entry = $entries[0]
    if ($null -eq $script:expectedRegistryKey) {
        $script:expectedRegistryKey = $entry.KeyName
    } elseif ($entry.KeyName -ne $script:expectedRegistryKey) {
        throw "Installer identity changed from $script:expectedRegistryKey to $($entry.KeyName)."
    }

    $applicationKey = "HKCU:\Software\$($entry.KeyName)"
    if (-not (Test-Path -LiteralPath $applicationKey)) {
        throw "Application registry key not found: $applicationKey"
    }
    $registeredInstallPath = (Get-ItemProperty -LiteralPath $applicationKey).InstallLocation
    if ($registeredInstallPath -ne $installPath) {
        throw "Registered install path is '$registeredInstallPath', expected '$installPath'."
    }
    if ($entry.Values.UninstallString -notlike "*$installPath*") {
        throw "Uninstall entry does not point to the test installation: $($entry.Values.UninstallString)"
    }
}

function Install-And-VerifyRuntime {
    param(
        [Parameter(Mandatory = $true)][string]$Installer,
        [Parameter(Mandatory = $true)][string]$ExpectedElectronVersion
    )

    $process = Start-Process `
        -FilePath $Installer `
        -ArgumentList @('/currentuser', '/S', "/D=$installPath") `
        -PassThru `
        -Wait `
        -WindowStyle Hidden
    if ($process.ExitCode -ne 0) {
        throw "Installer exited with code $($process.ExitCode): $Installer"
    }
    if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
        throw "Installed executable not found: $installedExecutable"
    }

    Assert-InstallerIdentity

    $output = (& $installedExecutable --version 2>&1 | Out-String).Trim()
    $match = [regex]::Match($output, '(?m)^\[startup\].*?\| Electron ([^ |]+) \|')
    if (-not $match.Success) {
        throw "Installed runtime did not report an Electron version. Output: $output"
    }
    $actualElectronVersion = $match.Groups[1].Value
    if ($actualElectronVersion -ne $ExpectedElectronVersion) {
        throw "Expected Electron $ExpectedElectronVersion, got $actualElectronVersion after installing $Installer"
    }
    if ($env:WINDOW_AUDIO_CAPTURE_SKIP -ne '1' -and -not $output.Contains('Module loaded successfully')) {
        throw 'window-audio-capture did not load from the installed application.'
    }
    if ($env:ELECTRON_ASIO_SKIP -ne '1' -and -not $output.Contains('ASIO IPC handlers registered')) {
        throw 'electron-asio did not load from the installed application.'
    }

    Write-Output "Verified installed Electron $actualElectronVersion from $([System.IO.Path]::GetFileName($Installer))."
}

try {
    Install-And-VerifyRuntime -Installer $fallbackPath -ExpectedElectronVersion '39.2.16-qp20'
    Install-And-VerifyRuntime -Installer $currentPath -ExpectedElectronVersion '43.3.0-qp20'
    Install-And-VerifyRuntime -Installer $fallbackPath -ExpectedElectronVersion '39.2.16-qp20'
} finally {
    $entries = @(Get-ElecapUninstallEntries)
    $entry = $entries | Where-Object { $_.KeyName -eq $script:expectedRegistryKey } | Select-Object -First 1
    if ($entry) {
        $quietUninstall = $entry.Values.QuietUninstallString
        if ($quietUninstall -notmatch '^"(?<executable>[^"]+)"\s*(?<arguments>.*)$') {
            throw "Cannot parse QuietUninstallString: $quietUninstall"
        }
        $uninstallArguments = @($Matches.arguments.Trim() -split '\s+' | Where-Object { $_ })
        $uninstallProcess = Start-Process `
            -FilePath $Matches.executable `
            -ArgumentList $uninstallArguments `
            -PassThru `
            -Wait `
            -WindowStyle Hidden
        if ($uninstallProcess.ExitCode -ne 0) {
            throw "Uninstaller exited with code $($uninstallProcess.ExitCode): $($Matches.executable)"
        }

        $uninstallDeadline = (Get-Date).AddSeconds(20)
        $applicationKey = "HKCU:\Software\$script:expectedRegistryKey"
        $uninstallKey = Join-Path $uninstallRegistryRoot $script:expectedRegistryKey
        while (((Test-Path -LiteralPath $installedExecutable) -or
                (Test-Path -LiteralPath $applicationKey) -or
                (Test-Path -LiteralPath $uninstallKey)) -and
               ((Get-Date) -lt $uninstallDeadline)) {
            Start-Sleep -Milliseconds 250
        }
        if (Test-Path -LiteralPath $installedExecutable) {
            throw "Uninstaller left the installed executable behind: $installedExecutable"
        }
        if ((Test-Path -LiteralPath $applicationKey) -or (Test-Path -LiteralPath $uninstallKey)) {
            throw 'Uninstaller left elecap registry keys behind.'
        }
        if (@(Get-ElecapUninstallEntries).Count -ne 0) {
            throw 'Uninstaller left an elecap uninstall entry behind.'
        }
    }

    if ((Test-Path -LiteralPath $installPath) -and
        @(Get-ChildItem -LiteralPath $installPath -Force).Count -eq 0) {
        Remove-Item -LiteralPath $installPath -Force
    }
}

Write-Output 'Windows installer replacement and rollback checks passed.'
