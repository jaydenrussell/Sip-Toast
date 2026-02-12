#!/usr/bin/env node
/**
 * Update Launcher - Runs before main app to check for and apply updates
 * This script can be used as update.exe or called during app startup
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

class UpdateLauncher {
  constructor() {
    this.updateDir = path.join(process.resourcesPath, 'updates');
    this.pendingUpdateDir = path.join(process.resourcesPath, 'pending-update');
    this.logger = this.createLogger();
  }

  /**
   * Create a simple logger
   */
  createLogger() {
    const logPath = path.join(process.resourcesPath, 'logs', 'update.log');
    
    // Ensure logs directory exists
    const logsDir = path.dirname(logPath);
    if (!fs.existsSync(logsDir)) {
      try {
        fs.mkdirSync(logsDir, { recursive: true });
      } catch (e) {
        // Ignore if already exists
      }
    }

    return {
      info: (msg) => {
        const timestamp = new Date().toISOString();
        const logMsg = `[${timestamp}] [INFO] ${msg}\n`;
        process.stdout.write(logMsg);
        try {
          fs.appendFileSync(logPath, logMsg);
        } catch (e) {
          // Ignore logging errors
        }
      },
      error: (msg) => {
        const timestamp = new Date().toISOString();
        const logMsg = `[${timestamp}] [ERROR] ${msg}\n`;
        process.stderr.write(logMsg);
        try {
          fs.appendFileSync(logPath, logMsg);
        } catch (e) {
          // Ignore logging errors
        }
      }
    };
  }

  /**
   * Check if there's a pending update to apply
   */
  checkPendingUpdate() {
    const markerFile = path.join(this.pendingUpdateDir, 'update-info.json');
    
    if (fs.existsSync(markerFile)) {
      try {
        const info = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
        this.logger.info(`Found pending update: ${info.version}`);
        return info;
      } catch (e) {
        this.logger.error(`Failed to read pending update info: ${e.message}`);
      }
    }
    
    return null;
  }

  /**
   * Apply a pending update
   */
  async applyPendingUpdate(updateInfo) {
    this.logger.info(`Applying update ${updateInfo.version}...`);
    
    // The actual update application is handled by electron-updater
    // This marker file tells the main app to restart after update
    
    const markerFile = path.join(process.resourcesPath, 'pending-update', 'restart-required.json');
    
    fs.writeFileSync(markerFile, JSON.stringify({
      version: updateInfo.version,
      appliedAt: new Date().toISOString(),
      restartRequired: true
    }));
    
    this.logger.info(`Update ${updateInfo.version} marked for application`);
    return true;
  }

  /**
   * Clean up old update files
   */
  cleanupOldUpdates() {
    if (!fs.existsSync(this.updateDir)) return;
    
    const files = fs.readdirSync(this.updateDir);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
    
    files.forEach(file => {
      const filePath = path.join(this.updateDir, file);
      try {
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          this.logger.info(`Cleaned up old update file: ${file}`);
        }
      } catch (e) {
        this.logger.error(`Failed to clean up ${file}: ${e.message}`);
      }
    });
  }

  /**
   * Launch the main application
   */
  launchMainApp() {
    const mainAppPath = process.execPath;
    const args = process.argv.slice(2);
    
    this.logger.info(`Launching main app: ${mainAppPath}`);
    
    const child = spawn(mainAppPath, ['--updated'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    
    child.unref();
    
    return { success: true, message: 'Main app launched' };
  }

  /**
   * Run the update launcher
   */
  async run() {
    this.logger.info('='.repeat(50));
    this.logger.info('Update Launcher started');
    this.logger.info(`Platform: ${process.platform}`);
    this.logger.info(`Exec path: ${process.execPath}`);
    this.logger.info(`Resources path: ${process.resourcesPath}`);
    this.logger.info('='.repeat(50));

    // Clean up old updates
    this.cleanupOldUpdates();

    // Check for pending updates
    const pendingUpdate = this.checkPendingUpdate();
    
    if (pendingUpdate) {
      this.logger.info(`Pending update found: ${pendingUpdate.version}`);
      
      // Apply the update
      await this.applyPendingUpdate(pendingUpdate);
    }

    // Launch the main application
    const result = this.launchMainApp();
    
    this.logger.info('Update Launcher finished');
    
    return result;
  }
}

// Main entry point
if (require.main === module) {
  const launcher = new UpdateLauncher();
  launcher.run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Update Launcher failed:', error);
      process.exit(1);
    });
}

module.exports = UpdateLauncher;
