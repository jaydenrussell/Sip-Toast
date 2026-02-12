@echo off
REM SIP Toast Update Launcher (Discord-style)
REM This script runs before the main application to check for updates
REM Rename this file to update.exe and configure installer to launch it instead of SIP Toast.exe

setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "APP_EXE=SIP Toast.exe"
set "UPDATE_LOG=%TEMP%\sip-toast-update.log"
set "GITHUB_API=https://api.github.com/repos/jaydenrussell/Sip-Toast/releases/latest"

REM Clear previous log
echo [Update] === SIP Toast Update Launcher === > "%UPDATE_LOG%"
echo [Update] Started at: %date% %time% >> "%UPDATE_LOG%"

REM Check for curl (prefer curl over PowerShell for better compatibility)
set "CURL_FOUND=0"
where curl >nul 2>nul
if %ERRORLEVEL% equ 0 (
    set "CURL_FOUND=1"
    echo [Update] Using curl for HTTP requests >> "%UPDATE_LOG%"
) else (
    echo [Update] curl not found, will skip network check >> "%UPDATE_LOG%"
)

REM If curl is available, check for updates
if %CURL_FOUND% equ 1 (
    echo [Update] Checking for updates... >> "%UPDATE_LOG%"
    
    for /f "tokens=*" %%i in ('curl -s -H "Accept: application/vnd.github.v3+json" "%GITHUB_API%" ^| findstr /r "tag_name"') do (
        set "RELEASE_INFO=%%i"
    )
    
    if defined RELEASE_INFO (
        echo [Update] Release info: !RELEASE_INFO! >> "%UPDATE_LOG%"
    )
)

REM Launch the main application
echo [Update] Launching SIP Toast... >> "%UPDATE_LOG%"
echo [Update] === Update check complete === >> "%UPDATE_LOG%"

start "" "%SCRIPT_DIR%%APP_EXE%"

endlocal
exit /b 0
