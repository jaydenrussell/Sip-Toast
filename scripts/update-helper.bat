@echo off
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
    echo Usage: update-helper.bat --msi "path	oile.msi" --app "SIP Toast.exe"
    pause
    exit /b 1
)

echo MSI: %MSI_PATH%
echo App: %APP_PATH%
echo.

:: Kill the main app if running
if not "%APP_PATH%"=="" (
    echo Closing SIP Toast...
    
    :: Try to kill by process name
    set "APP_NAME=%~nxAPP_PATH%"
    echo Looking for %APP_NAME%...
    
    tasklist /FI "IMAGENAME eq %APP_NAME%" /NH | findstr /i /C:"%APP_NAME%" >nul
    if !errorlevel!==0 (
        taskkill /F /IM "%APP_NAME%" 2>nul
        echo Process terminated
    ) else (
        echo Process not running
    )
    
    timeout /t 2 /nobreak >nul
)

echo Installing update...
echo.

:: Install MSI with basic UI (shows progress)
msiexec.exe /i "%MSI_PATH%" /qb- /norestart /l*v "%TEMP%sip-toast-install.log"

set "INSTALL_RESULT=%errorlevel%"

echo.
echo ========================================
if %INSTALL_RESULT%==0 (
    echo Installation completed successfully!
) else if %INSTALL_RESULT%==3010 (
    echo Installation completed. Restart required.
) else (
    echo Installation failed with code: %INSTALL_RESULT%
    pause
    exit /b %INSTALL_RESULT%
)
echo ========================================

:: Clean up MSI file
del "%MSI_PATH%" 2>nul

:: Restart the app if specified
if not "%APP_PATH%"=="" (
    if exist "%APP_PATH%" (
        echo Restarting SIP Toast...
        start "" "%APP_PATH%"
    )
)

echo Update complete!
timeout /t 3 /nobreak >nul
exit /b 0
