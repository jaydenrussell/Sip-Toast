/**
 * Squirrel.Windows event handlers
 */

const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Get the path to the update installer application
const getUpdateInstallerPath = () => {
  if (app.isPackaged) {
    // In packaged app, find the update installer in the same directory
    const appDir = path.dirname(app.getAppPath());
    const installerName = os.platform() === 'win32' ? 'sip-toast-update-installer.exe' : 'sip-toast-update-installer';
    return path.join(appDir, installerName);
  } else {
    // In development, use the local update-installer directory
    return path.join(__dirname, '..', '..', 'update-installer', 'dist', 'win-unpacked', 'sip-toast-update-installer.exe');
  }
};

// Proper Squirrel.Windows event handling
function handleSquirrelEvent(cmd) {
  console.log(`[Squirrel] Event: ${cmd}`);
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') {
    // Get the packages directory from command line arguments
    const packagesDir = process.argv.find(arg => arg.startsWith('--packages='))?.split('=')[1];
    if (packagesDir) {
      // Show installer window first
      if (mainWindow) {
        mainWindow.show();
      } else {
        createInstallerWindow();
      }

      // Launch the update installer
      const installerPath = getUpdateInstallerPath();
      if (fs.existsSync(installerPath)) {
        console.log(`[Squirrel] Launching update installer: ${installerPath}`);
        const updateProcess = spawn(installerPath, [`--packages=${packagesDir}`], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });
        updateProcess.unref();
        // Wait a moment for the installer to start, then quit
        setTimeout(() => { app.quit(); process.exit(0); }, 2000);
        return true;
      }
    }
    // Fallback to original behavior if installer fails
    console.log(`[Squirrel] Falling back to original update process`);
    setTimeout(() => { app.quit(); process.exit(0); }, 1000);
    return true;
  }
  if (cmd === '--squirrel-uninstall') {
    // Remove firewall rule
    const args = ['advfirewall', 'firewall', 'delete', 'rule', 'name="SIP Caller ID"'];
    console.log(`[Squirrel] Removing firewall rule`);
    const netsh = spawn('netsh', args, { stdio: 'ignore', windowsHide: true });
    netsh.on('close', (code) => console.log(`[Squirrel] Firewall removal result: ${code}`));
    setTimeout(() => { app.quit(); process.exit(0); }, 1000);
    return true;
  }
  if (cmd === '--squirrel-obsolete') {
    app.quit(); process.exit(0);
    return true;
  }
  return false;
}

function checkForSquirrelEvent() {
  const args = process.argv.slice(1);
  for (const arg of args) {
    if (arg.startsWith('--squirrel-')) return arg;
  }
  return false;
}

module.exports = { handleSquirrelEvent, checkForSquirrelEvent }; 
