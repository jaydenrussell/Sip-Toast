# Code Signing Configuration

This application is configured for code signing to ensure secure installation on Windows 11.

## Important Note About Free Code Signing Certificates

**There are no free trusted code signing certificates available from major Certificate Authorities.** Trusted CAs require identity verification and charge fees (typically $100-500/year) because code signing certificates need to be recognized by Windows and other operating systems.

However, you have these options:

1. **Self-Signed Certificate (Free, for testing only)** - See below
2. **Affordable Trusted Certificates** - See "Purchasing a Trusted Certificate" section
3. **Build without signing** - The app will work but show warnings

## Quick Start: Create a Self-Signed Certificate (Testing Only)

For development and testing, you can create a free self-signed certificate:

### Windows PowerShell (Recommended)
```powershell
# Run PowerShell as Administrator
cd sip-toast
.\scripts\create-certificate.ps1
```

### Windows Batch Script
```cmd
# Right-click and "Run as administrator"
scripts\create-certificate.bat
```

This will create `certificate.pfx` in the project root. Then set environment variables:
```powershell
$env:CSC_LINK="$PWD\certificate.pfx"
$env:CSC_KEY_PASSWORD="your_password_here"
```

**⚠️ Limitations of Self-Signed Certificates:**
- Users will see "Unknown Publisher" warnings
- Windows SmartScreen may block the installer
- Not suitable for public distribution
- Users must manually trust the certificate

## Setup Code Signing with a Trusted Certificate

### Option 1: Using Environment Variables (Recommended)

1. **Obtain a Code Signing Certificate**
   - Purchase from a trusted Certificate Authority (CA) like DigiCert, Sectigo, or GlobalSign
   - Or use a self-signed certificate for testing (not recommended for distribution)

2. **Set Environment Variables**
   
   For PowerShell:
   ```powershell
   $env:CSC_LINK="C:\path\to\your\certificate.pfx"
   $env:CSC_KEY_PASSWORD="your_certificate_password"
   ```

   For Command Prompt:
   ```cmd
   set CSC_LINK=C:\path\to\your\certificate.pfx
   set CSC_KEY_PASSWORD=your_certificate_password
   ```

   For permanent setup (PowerShell as Administrator):
   ```powershell
   [System.Environment]::SetEnvironmentVariable('CSC_LINK', 'C:\path\to\your\certificate.pfx', 'User')
   [System.Environment]::SetEnvironmentVariable('CSC_KEY_PASSWORD', 'your_certificate_password', 'User')
   ```

3. **Build the Application**
   ```bash
   npm run package
   ```

### Option 2: Using Certificate File Directly in package.json

If you prefer not to use environment variables, you can add these properties to the `win` section in `package.json`:

```json
"win": {
  "cscLink": "C:\\path\\to\\your\\certificate.pfx",
  "cscKeyPassword": "your_certificate_password"
}
```

**⚠️ Security Warning:** Never commit certificate files or passwords to version control! Consider using environment variables instead.

## Certificate Requirements

- **Format**: PFX (PKCS#12) file (.pfx or .p12)
- **Algorithm**: SHA-256 or higher
- **Validity**: Must be valid and not expired
- **Purpose**: Code Signing

## Purchasing a Trusted Certificate

For production use, you'll need to purchase a code signing certificate from a trusted CA. Here are some affordable options:

### Recommended Certificate Authorities:
1. **Sectigo (formerly Comodo)** - Starting around $99/year
   - Website: https://sectigo.com
   - Good balance of price and trust

2. **DigiCert** - Starting around $200/year
   - Website: https://www.digicert.com
   - Most trusted, higher cost

3. **GlobalSign** - Starting around $200/year
   - Website: https://www.globalsign.com
   - Well-established CA

4. **Code Signing Store** - Reseller with competitive prices
   - Website: https://codesigningstore.com
   - Often has discounts

### What You'll Need:
- Business registration (or personal identity verification)
- Government-issued ID
- Business phone number
- Email address
- Payment method

### After Purchase:
1. The CA will send you a PFX file or instructions to export it
2. Set the environment variables as shown in "Option 1" above
3. Build your application - it will be automatically signed

## Manual Certificate Creation (Alternative Method)

If you prefer to create a self-signed certificate manually:

```powershell
# Run PowerShell as Administrator
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=Jayden Russell" `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(3)

$password = Read-Host "Enter password" -AsSecureString
Export-PfxCertificate -Cert $cert -FilePath "certificate.pfx" -Password $password
```

**Note:** Self-signed certificates will show warnings during installation and are not suitable for distribution.

## Code Signing Requirements by Format

### MSIX/APPX Packages
**Code signing is MANDATORY** - MSIX packages will NOT install without a valid signature. You must have a certificate (even self-signed) to build MSIX packages.

### MSI Installers
**Code signing is OPTIONAL** - MSI installers will work without signing, but:
- Users will see "Unknown Publisher" warnings
- Windows SmartScreen may block the installer
- Some enterprise deployment tools (like SCCM) may refuse unsigned MSI packages
- For better user experience and trust, signing is strongly recommended

## Building Without Code Signing

If you don't have a certificate:
- **MSIX/APPX**: Cannot be built - you MUST have a certificate (even self-signed)
- **MSI**: Can be built without signing, but will show warnings

To build MSI only without code signing:
```bash
npm run package:msi
```

To build both formats, you need a certificate. To build without code signing, simply don't set the environment variables (but remember MSIX won't work).

## Troubleshooting

- **"Certificate file not found"**: Check that the path in CSC_LINK is correct
- **"Invalid certificate password"**: Verify CSC_KEY_PASSWORD is correct
- **"Certificate expired"**: Obtain a new certificate from your CA
- **"Access denied"**: Ensure you have permissions to read the certificate file

