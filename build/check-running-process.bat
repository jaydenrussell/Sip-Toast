@echo off
REM Check if SIP Toast is running and prompt user to close it

tasklist /FI "IMAGENAME eq SIP Toast.exe" 2>NUL | find /I /N "SIP Toast.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo SIP Toast is currently running.
    echo.
    choice /C YN /M "Do you want to close SIP Toast and continue with the installation"
    if errorlevel 2 goto :user_cancelled
    if errorlevel 1 goto :close_app
)

:close_app
echo Closing SIP Toast...
taskkill /F /IM "SIP Toast.exe" >NUL 2>&1
timeout /t 2 /nobreak >NUL

REM Check again if still running
tasklist /FI "IMAGENAME eq SIP Toast.exe" 2>NUL | find /I /N "SIP Toast.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo.
    echo ERROR: SIP Toast could not be closed automatically.
    echo Please close it manually and run the installer again.
    pause
    exit /b 1
)
echo SIP Toast has been closed. Continuing with installation...
exit /b 0

:user_cancelled
echo.
echo Installation cancelled. Please close SIP Toast and run the installer again.
pause
exit /b 1

