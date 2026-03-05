/**
 * Squirrel.Windows event handlers
 * Handles installation, updates, and uninstallation with comprehensive logging
 */

const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Setup installer logging
const logDir = path.join(os.homedir(), 'AppData', 'Roaming', 'sip-toast', 'logs');
const installLogPath = path.join(logDir, 'squirrel-install.log');

function ensureLogDir() {
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch (e) {
    // Ignore errors
  }
}

function logToFile(message) {
  ensureLogDir();
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(installLogPath, logEntry);
  } catch (e) {
    // Ignore file write errors
  }
  console.log(message);
}

// Proper Squirrel.Windows event handling
function handleSquirrelEvent(cmd) {
  logToFile(`[Squirrel] Event received: ${cmd}`);
  logToFile(`[Squirrel] Process args: ${process.argv.join(' ')}`);
  logToFile(`[Squirrel] App path: ${app.getAppPath()}`);
  logToFile(`[Squirrel] Exec path: ${process.execPath}`);
  
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') {
    // Get the packages directory from command line arguments
    const packagesDir = process.argv.find(arg => arg.startsWith('--packages='))?.split('=')[1];
    logToFile(`[Squirrel] Packages dir from args: ${packagesDir || 'NOT FOUND'}`);
    
    if (packagesDir) {
      // Launch the standalone Squirrel executable directly
      // This allows the application to close while the installer runs separately
      const squirrelExePath = path.join(path.dirname(app.getAppPath()), 'Update.exe');
      logToFile(`[Squirrel] Update.exe path: ${squirrelExePath}`);
      logToFile(`[Squirrel] Update.exe exists: ${fs.existsSync(squirrelExePath)}`);

      if (fs.existsSync(squirrelExePath)) {
        logToFile(`[Squirrel] Launching standalone Squirrel installer`);

        // Build the arguments for Squirrel
        // Correct format: Update.exe --install --packages <packagesDir>
        const args = [cmd === '--squirrel-install' ? '--install' : '--update', '--packages', packagesDir];

        logToFile(`[Squirrel] Executing: ${squirrelExePath} ${args.join(' ')}`);

        try {
          const updateProcess = spawn(squirrelExePath, args, {
            detached: true,
            stdio: 'ignore',
            windowsHide: true
          });

          updateProcess.unref();
          logToFile(`[Squirrel] Update process spawned with PID: ${updateProcess.pid}`);

          // Close the application immediately - the installer runs separately
          setTimeout(() => { 
            logToFile(`[Squirrel] Quitting application after spawning installer`);
            app.quit(); 
            process.exit(0); 
          }, 2000);
          return true;
        } catch (error) {
          logToFile(`[Squirrel] ERROR: Failed to spawn Update.exe: ${error.message}`);
          logToFile(`[Squirrel] Stack: ${error.stack}`);
        }
      } else {
        logToFile(`[Squirrel] ERROR: Update.exe not found at: ${squirrelExePath}`);
      }
    } else {
      logToFile(`[Squirrel] ERROR: No --packages argument found`);
      logToFile(`[Squirrel] Full argv: ${JSON.stringify(process.argv)}`);
    }
    
    // Fallback to original behavior if Squirrel.exe fails or packages dir not found
    logToFile(`[Squirrel] Falling back to original update process`);
    setTimeout(() => { 
      logToFile(`[Squirrel] Quitting with fallback`);
      app.quit(); 
      process.exit(0); 
    }, 2000);
    return true;
  }
  
  if (cmd === '--squirrel-uninstall') {
    logToFile(`[Squirrel] Uninstall event received`);
    // Remove firewall rule
    const args = ['advfirewall', 'firewall', 'delete', 'rule', 'name="SIP Caller ID"'];
    logToFile(`[Squirrel] Removing firewall rule`);
    const netsh = spawn('netsh', args, { 
      stdio: 'ignore', 
      windowsHide: true 
    });
    
    netsh.on('close', (code) => {
      logToFile(`[Squirrel] Firewall removal result: ${code}`);
      setTimeout(() => { 
        logToFile(`[Squirrel] Quitting after uninstall`);
        app.quit(); 
        process.exit(0); 
      }, 2000);
    });
    
    netsh.on('error', (error) => {
      logToFile(`[Squirrel] Firewall removal error: ${error.message}`);
      setTimeout(() => { 
        logToFile(`[Squirrel] Quitting after uninstall error`);
        app.quit(); 
        process.exit(0); 
      }, 2000);
    });
    return true;
  }
  
  if (cmd === '--squirrel-obsolete') {
    logToFile(`[Squirrel] Obsolete event received`);
    app.quit(); 
    process.exit(0);
    return true;
  }
  
  logToFile(`[Squirrel] Unknown command: ${cmd}`);
  return false;
}

function checkForSquirrelEvent() {
  const args = process.argv.slice(1);
  for (const arg of args) {
    if (arg.startsWith('--squirrel-')) {
      logToFile(`[Squirrel] Detected squirrel event: ${arg}`);
      return arg;
    }
  }
  logToFile(`[Squirrel] No squirrel event detected`);
  return false;
}

module.exports = { handleSquirrelEvent, checkForSquirrelEvent, getInstallLogPath: () => installLogPath }; 
