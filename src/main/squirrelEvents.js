/**
 * Squirrel.Windows event handlers
 */

const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

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
function addFirewallRule() {
  try {
    const exePath = app.getPath('exe');
    const appName = 'SIP Caller ID';
    const args = ['advfirewall', 'firewall', 'add', 'rule', `name="${appName}"`, 'dir=out', 'action=allow', `program="${exePath}"`, 'enable=yes'];
    console.log(`[Squirrel] Adding firewall rule`);
    const netsh = spawn('netsh', args, { stdio: 'ignore', windowsHide: true });
    netsh.on('close', (code) => console.log(`[Squirrel] Firewall rule result: ${code}`));
    return true;
  } catch (error) {
    console.error(`[Squirrel] Error adding firewall rule: ${error.message}`);
    return false;
  }
}

function launchUpdateInstaller(packagesDir) {
  try {
    // Use the development version directly
    const installerPath = path.join(__dirname, '..', '..', 'update-installer', 'dev-start.js');
    if (!fs.existsSync(installerPath)) {
      console.error(`[Squirrel] Update installer not found at: ${installerPath}`);
      return false;
    }

    console.log(`[Squirrel] Launching update installer: ${installerPath}`);
    const updateProcess = spawn('node', [installerPath, `--packages=${packagesDir}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    // Detach the child process so it continues after we exit
    updateProcess.unref();
    return true;
  } catch (error) {
    console.error(`[Squirrel] Failed to launch update installer: ${error.message}`);
    return false;
  }
}
function removeFirewallRule() {
  try {
    const args = ['advfirewall', 'firewall', 'delete', 'rule', 'name="SIP Caller ID"'];
    console.log(`[Squirrel] Removing firewall rule`);
    const netsh = spawn('netsh', args, { stdio: 'ignore', windowsHide: true });
    netsh.on('close', (code) => console.log(`[Squirrel] Firewall removal result: ${code}`));
    return true;
  } catch (error) {
    return false;
  }
}

function handleSquirrelEvent(cmd) {
  console.log(`[Squirrel] Event: ${cmd}`);
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') {
    addFirewallRule();
    // Get the packages directory from command line arguments
    const packagesDir = process.argv.find(arg => arg.startsWith('--packages='))?.split('=')[1];
    if (packagesDir) {
      if (launchUpdateInstaller(packagesDir)) {
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
    removeFirewallRule();
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

module.exports = { handleSquirrelEvent, checkForSquirrelEvent, addFirewallRule, removeFirewallRule };