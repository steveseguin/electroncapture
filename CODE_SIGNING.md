# Windows Code Signing Certificate

Official Electron Capture Windows builds are signed with the self-signed public certificate in
`code-signing-cert.pem`. The signature establishes that the installer and portable executable came
from the same Electron Capture build identity, but Windows does not inherently trust a self-signed
certificate.

## Certificate details

- Subject: `CN=Electron Capture, O=Steve Seguin, L=Canada, E=steve@seguin.email, OU=vdo.ninja`
- Valid from: July 20, 2026
- Valid until: July 17, 2036
- SHA-256 fingerprint: `EE:45:EC:3B:E0:70:F0:AA:AE:EE:2A:78:25:E3:C2:0A:21:14:2B:13:7D:9C:A8:FB:5A:09:34:0A:4B:E3:0B:A5`

## Verify a Windows release

```powershell
$signature = Get-AuthenticodeSignature "elecap-2.23.3.exe"
$signature.SignerCertificate.Subject
$signature.SignerCertificate.Thumbprint
$signature.TimeStamperCertificate.Subject
```

The signer thumbprint should be `C48A2F691E4B3362B47382B9C6AA3391AA96CA0A`. The signature status may be
`UnknownError` on machines that do not trust this self-signed certificate; the signer thumbprint and
trusted timestamp are the useful verification fields.

The private key and PFX file are ignored by Git and must never be committed. GitHub Actions restores
the PFX from the `WIN_CSC_PFX_BASE64` secret and reads its password from `WIN_CSC_KEY_PASSWORD`.
