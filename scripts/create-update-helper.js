// This script generates a batch file that handles the update process
// Run this once before building: node scripts/create-update-helper.js

const fs = require('fs');
const path = require('path');

const outputPath = path.join(__dirname, 'update-helper.bat');

// The MSI Product Code - this should match the appId in package.json
// For electron-builder, we need to find it in the MSI or use a known GUID
// We'll search for installed SIP Toast and uninstall it

const batchContent = `@echo off
setlocal enabledelayedexpansion

echo ========================================
echo SIP Toast Update Helper
echo ========================================
echo.

:: Get MSI path from command line argument
set "MSI_PATH="
set "APP_PATH="

:parse_args
if "%~1"=="" goto done_args
if /i "%~1"=="--msi" (
    set "MSI_PATH=%~2"
    shift
    shift
    goto parse_args
)
if /i "%~1"=="--app" (
    set "APP_PATH=%~2"
    shift
    shift
    goto parse_args
)
shift
goto parse_args

:done_args
if "%MSI_PATH%"=="" (
    echo ERROR: No MSI path specified
    echo Usage: update-helper.bat --msi "path\to\file.msi" --app "SIP Toast.exe"
    pause
    exit /b 1
)

echo MSI: %MSI_PATH%
echo App: %APP_PATH%
echo.

:: First, uninstall any existing version
echo Checking for existing installation...
for /f "tokens=2,* delims=	 " %%a in ('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s 2^>nul ^| findstr /i "SIP Toast"') do (
    set "UNINSTKEY=%%a %%b"
    goto :found_uninstall
)

:: Also check 32-bit registry on 64-bit Windows
for /f "tokens=2,* delims=	 " %%a in ('reg query "HKLM\\SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall" /s 2^>nul ^| findstr /i "SIP Toast"') do (
    set "UNINSTKEY=%%a %%b"
    goto :found_uninstall
)

:found_uninstall
if defined UNINSTKEY (
    echo Found existing installation, uninstalling...
    for /f "tokens=2,* delims=	 " %%a in ('reg query "!UNINSTKEY!" /v UninstallString 2^>nul') do (
        set "UNINSTCMD=%%a %%b"
    )
    
    if defined UNINSTCMD (
        echo Running: !UNINSTCMD!
        !UNINSTCMD! /qn /norestart
        echo Waiting for uninstall to complete...
        timeout /t 5 /nobreak >nul
    )
) else (
    echo No existing installation found, will install fresh
)

:: Kill the main app if running (in case it's still running)
if not "%APP_PATH%"=="" (
    echo Closing SIP Toast...
    
    :: Try to kill by process name
    set "APP_NAME=%~nxAPP_PATH%"
    
    tasklist /FI "IMAGENAME eq %APP_NAME%" /NH | findstr /i /C:"%APP_NAME%" >nul
    if !errorlevel!==0 (
        taskkill /F /IM "%APP_NAME%" 2>nul
        echo Process terminated
    ) else (
        echo Process not running
    )
    
    timeout /t 2 /nobreak >nul
)

echo.
echo ========================================
echo Installing new version...
echo ========================================
echo.

:: Install MSI with basic UI (shows progress)
msiexec.exe /i "%MSI_PATH%" /qb- /norestart /l*v "%TEMP%\sip-toast-install.log"

set "INSTALL_RESULT=%errorlevel%"

echo.
echo ========================================
if %INSTALL_RESULT%==0 (
    echo Installation completed successfully!
) else if %INSTALL_RESULT%==3010 (
    echo Installation completed. Restart required.
) else if %INSTALL_RESULT%==1605 (
    echo ERROR: Previous version not found. Trying repair...
    msiexec.exe /i "%MSI_PATH%" /qb- /norestart
    set "INSTALL_RESULT=%errorlevel%"
    if %INSTALL_RESULT%==0 (
        echo Repair completed successfully!
    ) else (
        echo Repair failed with code: %INSTALL_RESULT%
    )
) else (
    echo Installation failed with code: %INSTALL_RESULT%
)
echo ========================================

:: Clean up MSI file
del "%MSI_PATH%" 2>nul

:: Restart the app if specified
if not "%APP_PATH%"=="" (
    echo Waiting for installer to finish...
    timeout /t 3 /nobreak >nul
    
    if exist "%APP_PATH%" (
        echo Restarting SIP Toast...
        start "" "%APP_PATH%"
    ) else (
        echo Could not find app at %APP_PATH%
        :: Try to find in common locations
        if exist "%ProgramFiles%\\SIP Toast\\SIP Toast.exe" (
            start "" "%ProgramFiles%\\SIP Toast\\SIP Toast.exe"
        ) else if exist "%ProgramFiles(x86)%\\SIP Toast\\SIP Toast.exe" (
            start "" "%ProgramFiles(x86)%\\SIP Toast\\SIP Toast.exe"
        )
    )
)

echo.
echo Update complete!
timeout /t 5 /nobreak >nul
exit /b 0
`;

// Write the batch file
fs.writeFileSync(outputPath, batchContent);
console.log(`Created update helper: ${outputPath}`);
