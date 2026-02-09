@echo off
cd /d "%~dp0"
echo Starting build at %date% %time% > build-status.txt
echo. >> build-status.txt

echo Incrementing version... >> build-status.txt
node scripts/increment-version.js >> build-status.txt 2>&1
if errorlevel 1 (
    echo ERROR: Version increment failed >> build-status.txt
    exit /b 1
)

echo Version incremented successfully >> build-status.txt
echo. >> build-status.txt

echo Starting electron-builder... >> build-status.txt
npx electron-builder --win >> build-status.txt 2>&1
if errorlevel 1 (
    echo ERROR: Build failed >> build-status.txt
    exit /b 1
)

echo Build completed successfully at %date% %time% >> build-status.txt
echo BUILD_COMPLETE > build-complete.flag
