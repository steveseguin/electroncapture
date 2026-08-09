[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('x64', 'arm64')]
    [string]$Architecture,
    [ValidateSet('win10', 'win11')]
    [string]$Variant = 'win10',
    [string]$DistDirectory,
    [string]$PublicCertificate
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DistDirectory)) {
    $DistDirectory = Join-Path $PSScriptRoot '..\dist'
}
if ([string]::IsNullOrWhiteSpace($PublicCertificate)) {
    $PublicCertificate = Join-Path $PSScriptRoot '..\code-signing-cert.pem'
}

$distPath = [System.IO.Path]::GetFullPath($DistDirectory)
$certificatePath = [System.IO.Path]::GetFullPath($PublicCertificate)
$packagePath = Join-Path $PSScriptRoot '..\package.json'
$version = (Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json).version
$expectedMachine = if ($Architecture -eq 'x64') { 0x8664 } else { 0xaa64 }

if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf)) {
    throw "Public signing certificate not found: $certificatePath"
}

function Get-PeMachine {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::Open($Path, 'Open', 'Read', 'ReadWrite')
    $reader = [System.IO.BinaryReader]::new($stream)
    try {
        if ($reader.ReadUInt16() -ne 0x5a4d) { throw "Not a PE file: $Path" }
        $stream.Position = 0x3c
        $peOffset = $reader.ReadUInt32()
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) { throw "Missing PE header: $Path" }
        return $reader.ReadUInt16()
    } finally {
        $reader.Dispose()
        $stream.Dispose()
    }
}

$releaseFiles = if ($Architecture -eq 'x64' -and $Variant -eq 'win11') {
    @(
        (Join-Path $distPath "elecap-$version-win11.exe"),
        (Join-Path $distPath 'elecap-win11.exe')
    )
} elseif ($Architecture -eq 'x64') {
    @(
        (Join-Path $distPath "elecap-$version.exe"),
        (Join-Path $distPath 'elecap.exe')
    )
} else {
    @(
        (Join-Path $distPath "elecap-$version-win-arm64-setup.exe"),
        (Join-Path $distPath "elecap-$version-win-arm64-portable.exe")
    )
}

foreach ($file in $releaseFiles) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Expected signed Windows artifact not found: $file"
    }
}

$unpackedFiles = @(
    Get-ChildItem -LiteralPath $distPath -Filter 'elecap.exe' -File -Recurse |
        Where-Object { $_.DirectoryName -match 'unpacked' -and (Get-PeMachine -Path $_.FullName) -eq $expectedMachine }
)
if ($unpackedFiles.Count -ne 1) {
    throw "Expected one $Architecture unpacked elecap.exe, found $($unpackedFiles.Count)."
}

$certificatePem = Get-Content -Raw -LiteralPath $certificatePath
$certificateBase64 = ($certificatePem -replace '-----BEGIN CERTIFICATE-----', '' -replace '-----END CERTIFICATE-----', '' -replace '\s', '')
$certificateBytes = [System.Convert]::FromBase64String($certificateBase64)
$publicCert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList @(,$certificateBytes)
$expectedThumbprint = $publicCert.Thumbprint
$filesToVerify = @($releaseFiles) + @($unpackedFiles.FullName)

foreach ($file in $filesToVerify) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($null -eq $signature.SignerCertificate) {
        throw "Authenticode signature missing: $file"
    }
    if ($signature.SignerCertificate.Thumbprint -ne $expectedThumbprint -or
        [System.Convert]::ToBase64String($signature.SignerCertificate.RawData) -ne
            [System.Convert]::ToBase64String($publicCert.RawData)) {
        throw "Unexpected signing certificate on $file. Expected $expectedThumbprint, got $($signature.SignerCertificate.Thumbprint)."
    }
    if ($signature.SignatureType -ne [System.Management.Automation.SignatureType]::Authenticode) {
        throw "Expected an embedded Authenticode signature on $file, got $($signature.SignatureType)."
    }

    $statusIsValid = $signature.Status -eq [System.Management.Automation.SignatureStatus]::Valid
    $statusIsOnlyPinnedRootTrust =
        $signature.Status -eq [System.Management.Automation.SignatureStatus]::UnknownError -and
        $signature.StatusMessage -eq 'A certificate chain processed, but terminated in a root certificate which is not trusted by the trust provider'
    if (-not $statusIsValid -and -not $statusIsOnlyPinnedRootTrust) {
        throw "Authenticode signature verification failed on $file. Status: $($signature.Status); message: $($signature.StatusMessage)"
    }

    # Get-AuthenticodeSignature reports HashMismatch for modified PE content.
    # The accepted UnknownError is only the expected trust result for the exact
    # pinned self-signed certificate; no certificate-store mutation is needed.
    if ($null -eq $signature.TimeStamperCertificate) {
        throw "Authenticode timestamp missing from signature: $file"
    }
    $relativePath = if ($file.StartsWith($distPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $file.Substring($distPath.Length).TrimStart('\', '/')
    } else {
        $file
    }
    Write-Output "Verified $Architecture signature: $relativePath"
}

Write-Output "Verified Electron Capture signer $expectedThumbprint and Authenticode timestamps on $($filesToVerify.Count) executables."
