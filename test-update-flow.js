const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function testUpdateFlow() {
  console.log('Testing update flow...');

  // Get the current application path
  const appPath = process.execPath;
  console.log(`Current application path: ${appPath}`);

  // Get the packages directory (this would be set by Squirrel during update)
  const packagesDir = path.join(appPath, '..', 'packages');
  console.log(`Packages directory: ${packagesDir}`);

  // Check if Update.exe exists
  const updateExe = path.join(packagesDir, '..', 'Update.exe');
  if (!fs.existsSync(updateExe)) {
    console.log('Update.exe not found - this is expected in development');
  } else {
    console.log('Update.exe found');
  }

  // Check if update installer exists
  const installerPath = path.join(__dirname, 'update-installer', 'dev-start.js');
  if (!fs.existsSync(installerPath)) {
    console.error('Update installer not found!');
    return;
  }
  console.log('Update installer found');

  // Test launching the update installer
  console.log('Testing update installer launch...');
  const updateProcess = spawn('node', [installerPath, `--packages=${packagesDir}`], {
    detached: false,
    stdio: 'inherit'
  });

  updateProcess.on('close', (code) => {
    console.log(`Update installer exited with code: ${code}`);
  });

  updateProcess.on('error', (error) => {
    console.error(`Failed to launch update installer: ${error.message}`);
  });
}

testUpdateFlow();