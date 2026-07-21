[CmdletBinding()]
param(
    [string]$Password = $env:WIN_CSC_KEY_PASSWORD,
    [string]$OutputDirectory,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Password)) {
    throw 'Set WIN_CSC_KEY_PASSWORD or pass -Password before creating the certificate.'
}

if (-not (Get-Command openssl -ErrorAction SilentlyContinue)) {
    throw 'OpenSSL is required to create the Windows signing certificate.'
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $PSScriptRoot '..\certs'
}

$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$privateKeyPath = Join-Path $outputPath 'key.pem'
$certificatePath = Join-Path $outputPath 'cert.pem'
$pfxPath = Join-Path $outputPath 'electroncapture.pfx'
$configPath = Join-Path $outputPath 'openssl.cnf'
$publicCertificatePath = Join-Path $projectRoot 'code-signing-cert.pem'

if (-not $Force) {
    foreach ($path in @($privateKeyPath, $certificatePath, $pfxPath, $publicCertificatePath)) {
        if (Test-Path -LiteralPath $path) {
            throw "Refusing to overwrite existing certificate material: $path. Use -Force only when intentionally replacing it."
        }
    }
}

New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

$config = @'
[ req ]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
x509_extensions = code_signing

[ dn ]
CN = Electron Capture
O = Steve Seguin
L = Canada
emailAddress = steve@seguin.email
OU = vdo.ninja

[ code_signing ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = codeSigning
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
'@

[System.IO.File]::WriteAllText($configPath, $config, (New-Object System.Text.UTF8Encoding($false)))

& openssl genrsa -out $privateKeyPath 2048
if ($LASTEXITCODE -ne 0) { throw 'OpenSSL failed to generate the private key.' }

& openssl req -new -x509 -key $privateKeyPath -out $certificatePath -days 3650 -config $configPath
if ($LASTEXITCODE -ne 0) { throw 'OpenSSL failed to generate the certificate.' }

$previousPassword = $env:ELECAP_CERT_EXPORT_PASSWORD
try {
    $env:ELECAP_CERT_EXPORT_PASSWORD = $Password
    & openssl pkcs12 -export -out $pfxPath -inkey $privateKeyPath -in $certificatePath -name 'Electron Capture' -passout env:ELECAP_CERT_EXPORT_PASSWORD
    if ($LASTEXITCODE -ne 0) { throw 'OpenSSL failed to generate the PFX file.' }
} finally {
    if ($null -eq $previousPassword) {
        Remove-Item Env:ELECAP_CERT_EXPORT_PASSWORD -ErrorAction SilentlyContinue
    } else {
        $env:ELECAP_CERT_EXPORT_PASSWORD = $previousPassword
    }
}

Copy-Item -LiteralPath $certificatePath -Destination $publicCertificatePath -Force
Write-Output "Private signing certificate: $pfxPath"
Write-Output "Public verification certificate: $publicCertificatePath"
& openssl x509 -in $publicCertificatePath -noout -subject -dates -fingerprint -sha256
