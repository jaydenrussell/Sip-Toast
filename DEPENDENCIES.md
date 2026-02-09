# SIP Toast - System Dependencies and Requirements

## Overview

This document outlines all system dependencies and requirements for running SIP Toast on Windows computers.

## ✅ Bundled Dependencies (Included in MSI Installer)

All of the following dependencies are **automatically bundled** with the MSI installer and do not need to be installed separately:

### Runtime Dependencies (Bundled)
- **Electron 31.3.0** - Complete runtime bundled with the application
- **Node.js modules** - All npm dependencies are bundled:
  - `axios` (^1.6.8) - HTTP client for API calls
  - `electron-store` (^8.1.0) - Settings storage
  - `eventemitter3` (^5.0.1) - Event handling
  - `sip` (^0.0.6) - Pure JavaScript SIP stack (no native dependencies)
  - `winston` (^3.11.0) - Logging library

### Application Files (Bundled)
- All source code (`src/**/*`)
- Application icons (`Images/**/*`)
- Configuration files

## ⚠️ System Requirements (NOT Bundled - Must Be Present)

These are Windows system requirements that must already be installed on the target computer:

### 1. Operating System
- **Windows 10** (version 1809 or later) - **REQUIRED**
- **Windows 11** - Fully supported
- **Windows Server 2019/2022** - Supported
- **Windows 7/8/8.1** - **NOT SUPPORTED** (Electron 31+ requires Windows 10+)

### 2. Microsoft Visual C++ Redistributable
- **Visual C++ Redistributable 2015-2022** (x64) - **MAY BE REQUIRED**
  - Download: https://aka.ms/vs/17/release/vc_redist.x64.exe
  - Most modern Windows 10/11 systems already have this installed
  - Required if you see errors like: "The code execution cannot proceed because VCRUNTIME140.dll was not found"

### 3. Network Requirements
- **Internet connectivity** - Required for:
  - SIP server connections
  - Acuity Scheduling API calls
  - Caller ID API lookups
- **DNS resolution** - Required for SIP server hostname resolution
- **Firewall** - Must allow outbound connections on:
  - SIP ports (typically 5060 UDP/TCP, 5061 TLS)
  - HTTPS (443) for API calls

### 4. Hardware Requirements
- **64-bit (x64) processor** - Required (application is built for x64 only)
- **RAM**: Minimum 100MB, Recommended 256MB+
- **Disk Space**: ~150MB for installation

## 🔍 Verifying Dependencies on Target Computer

### Check Windows Version
```powershell
# Run in PowerShell
[System.Environment]::OSVersion.Version
# Should show version 10.0.xxxxx or higher
```

### Check Visual C++ Redistributable
```powershell
# Check if installed
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" | 
    Where-Object { $_.DisplayName -like "*Visual C++*" } | 
    Select-Object DisplayName, DisplayVersion
```

### Check if Application Runs
1. Install the MSI: `SIP Toast 0.67.58.msi`
2. Launch the application
3. Check for error messages in:
   - Windows Event Viewer
   - Application logs: `%APPDATA%\sip-toast\logs\sip-toast.log`

## 🛠️ Troubleshooting Missing Dependencies

### Issue: "The code execution cannot proceed because VCRUNTIME140.dll was not found"
**Solution**: Install Visual C++ Redistributable 2015-2022 (x64)
- Download: https://aka.ms/vs/17/release/vc_redist.x64.exe
- Run the installer
- Restart the application

### Issue: Application won't start on Windows 7/8/8.1
**Solution**: Upgrade to Windows 10 or later (Electron 31+ requires Windows 10+)

### Issue: "Cannot find module" errors
**Solution**: This should not happen if dependencies are properly bundled. If it does:
1. Reinstall the MSI
2. Check that `asar: true` is set in `package.json` build config
3. Verify the installation directory contains all files

### Issue: Network/SIP connection failures
**Solution**: Check:
1. Internet connectivity
2. Firewall settings (allow outbound connections)
3. DNS resolution (can you ping the SIP server?)
4. SIP server credentials are correct

## 📦 What Gets Installed

When you install the MSI, the following is installed:

```
C:\Users\<Username>\AppData\Local\Programs\sip-toast\
├── SIP Toast.exe          # Main executable (includes Electron runtime)
├── resources/
│   ├── app.asar           # Bundled application code and dependencies
│   └── Images/            # Application icons
└── [Electron runtime files] # All Electron DLLs and binaries
```

**User Data** (created at runtime):
```
%APPDATA%\sip-toast\
├── config.json            # Application settings
├── logs/
│   ├── sip-toast.log      # Application logs
│   └── sip-toast-events.log # Event logs
```

## 🔐 Security Considerations

- All dependencies are bundled and do not require external package managers
- No internet connection required for installation (only for runtime functionality)
- Application runs in isolated Electron sandbox
- Credentials stored in `%APPDATA%\sip-toast\config.json` (encrypted if encryption.js is used)

## 📝 Developer Notes

### Building with Dependencies
The build process automatically:
1. Bundles all `dependencies` from `package.json`
2. Includes Electron runtime
3. Packages everything into `app.asar` (unless `asar: false`)
4. Creates a standalone MSI installer

### Verifying Bundle Contents
After building, check:
```powershell
# Extract and inspect asar file (if needed)
npx asar extract "dist\win-unpacked\resources\app.asar" extracted-app
```

## 📞 Support

If the application works on one computer but not another:
1. Check Windows version (must be Windows 10+)
2. Install Visual C++ Redistributable if missing
3. Check application logs: `%APPDATA%\sip-toast\logs\sip-toast.log`
4. Verify network connectivity and firewall settings
