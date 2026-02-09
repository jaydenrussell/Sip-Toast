@echo off
REM Batch script to create a self-signed code signing certificate
REM Run this script as Administrator

echo Creating self-signed code signing certificate...
echo.

REM Check if running as administrator
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: This script must be run as Administrator!
    echo Right-click and select "Run as administrator"
    pause
    exit /b 1
)

REM Certificate details
set "CERT_PATH=%~dp0..\certificate.pfx"
set "SUBJECT=CN=Jayden Russell"

echo Creating certificate...
powershell -ExecutionPolicy Bypass -Command ^
    "$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject '%SUBJECT%' -CertStoreLocation Cert:\CurrentUser\My -KeyUsage DigitalSignature -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddYears(3); ^
    $password = Read-Host 'Enter a password for the certificate (min 6 characters)' -AsSecureString; ^
    Export-PfxCertificate -Cert $cert -FilePath '%CERT_PATH%' -Password $password -Force; ^
    Write-Host 'Certificate created successfully!' -ForegroundColor Green; ^
    Write-Host \"Thumbprint: $($cert.Thumbprint)\" -ForegroundColor Yellow; ^
    Write-Host \"Certificate exported to: %CERT_PATH%\" -ForegroundColor Green"

if %errorLevel% equ 0 (
    echo.
    echo To use this certificate for code signing, set these environment variables:
    echo   set CSC_LINK=%CERT_PATH%
    echo   set CSC_KEY_PASSWORD=^<your_password^>
    echo.
    echo IMPORTANT: This is a self-signed certificate.
    echo   - It will show 'Unknown Publisher' warnings during installation
    echo   - Not suitable for public distribution
    echo   - For production, purchase a certificate from a trusted CA
) else (
    echo Failed to create certificate.
)

pause

