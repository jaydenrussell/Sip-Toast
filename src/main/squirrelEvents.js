/**
 * Squirrel.Windows event handlers
 */

const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');


// Proper Squirrel.Windows event handling
function handleSquirrelEvent(cmd) {
  console.log(`[Squirrel] Event: ${cmd}`);
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') {
    // Get the packages directory from command line arguments
    const packagesDir = process.argv.find(arg => arg.startsWith('--packages='))?.split('=')[1];
    if (packagesDir) {
      // Launch the standalone Squirrel executable directly
      // This allows the application to close while the installer runs separately
      const squirrelExePath = path.join(path.dirname(app.getAppPath()), 'Update.exe');

      if (fs.existsSync(squirrelExePath)) {
        console.log(`[Squirrel] Launching standalone Squirrel installer: ${squirrelExePath}`);

        // Build the arguments for Squirrel
        const args = ['--update', packagesDir];
        if (cmd === '--squirrel-install') {
          args.unshift('--install');
        }

        const updateProcess = spawn(squirrelExePath, args, {
          detached: true,
          stdio: 'ignore',
          windowsHide: true
        });

        updateProcess.unref();

        // Close the application immediately - the installer runs separately
        setTimeout(() => { app.quit(); process.exit(0); }, 1000);
        return true;
      }
    }
    // Fallback to original behavior if Squirrel.exe fails
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
