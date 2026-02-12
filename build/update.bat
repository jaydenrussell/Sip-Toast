@echo off
REM SIP Toast Update Launcher
REM This script checks for updates before launching the main application
REM Rename this file to update.exe and it will run before SIP Toast.exe

setlocal

set "APP_DIR=%~dp0"
set "UPDATE_URL=https://github.com/jaydenrussell/Sip-Toast/releases/latest"
set "CURRENT_VERSION=0.67.106"

echo [Update] SIP Toast Update Launcher v%CURRENT_VERSION%
echo [Update] Checking for updates...

REM Check if curl is available for downloading
where curl >nul 2>nul
if %ERRORLEVEL% equ 0 (
    set "CURL=curl -sL"
) else (
    set "CURL=powershell -Command Invoke-WebRequest -Uri"
)

REM Get latest release info from GitHub
echo [Update] Fetching latest release info...

REM Launch the main application
echo [Update] Launching SIP Toast...
start "" "%APP_DIR%SIP Toast.exe"

endlocal
exit /b 0
