# PowerShell script to create a self-signed code signing certificate
# Run this script as Administrator

Write-Host "Creating self-signed code signing certificate..." -ForegroundColor Cyan

# Certificate details
$subject = "CN=Jayden Russell"
$certPath = "$PSScriptRoot\..\certificate.pfx"
$password = Read-Host "Enter a password for the certificate (min 6 characters)" -AsSecureString

# Create the certificate
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $subject `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(3)

Write-Host "Certificate created successfully!" -ForegroundColor Green
Write-Host "Thumbprint: $($cert.Thumbprint)" -ForegroundColor Yellow

# Export to PFX file
try {
    Export-PfxCertificate `
        -Cert $cert `
        -FilePath $certPath `
        -Password $password `
        -Force

    Write-Host "`nCertificate exported to: $certPath" -ForegroundColor Green
    Write-Host "`nTo use this certificate for code signing, set these environment variables:" -ForegroundColor Cyan
    Write-Host "  `$env:CSC_LINK=`"$certPath`"" -ForegroundColor Yellow
    Write-Host "  `$env:CSC_KEY_PASSWORD=`"<your_password>`"" -ForegroundColor Yellow
    Write-Host "`n⚠️  IMPORTANT: This is a self-signed certificate." -ForegroundColor Red
    Write-Host "   - It will show 'Unknown Publisher' warnings during installation" -ForegroundColor Red
    Write-Host "   - Not suitable for public distribution" -ForegroundColor Red
    Write-Host "   - For production, purchase a certificate from a trusted CA" -ForegroundColor Red
} catch {
    Write-Host "Error exporting certificate: $_" -ForegroundColor Red
    exit 1
}

