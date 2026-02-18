const { logger } = require('./logger');
const { EventEmitter } = require('events');
const { app, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/**
 * Squirrel.Windows Auto-Updater Service (Discord/Teams-style)
 * 
 * Update Flow (exactly like Discord and Microsoft Teams):
 * 
 * 1. **Silent Background Check**: App checks for updates on startup (30s delay)
 * 2. **Silent Download**: Updates download in background without user interaction
 * 3. **Apply on Restart**: Update is applied when user naturally restarts the app
 * 4. **No Forced Restarts**: User is never interrupted or forced to quit
 * 5. **Update.exe**: Squirrel.Windows handles all the heavy lifting
 * 
 * How Discord/Teams do it:
 * - Check for updates shortly after app starts
 * - Download updates silently in background
 * - Show a small indicator when update is ready (optional)
 * - Apply update on next app launch (user-initiated restart)
 * - The Update.exe process handles the actual file replacement
 * 
 * Squirrel.Windows Update.exe locations:
 * - %LocalAppData%\SIPToast\Update.exe (user install)
 * - The Update.exe is placed by Squirrel in the app's parent directory
 */
class UpdateService extends EventEmitter {
  constructor() {
    super();
    
    // State
    this.isChecking = false;
    this.isDownloading = false;
    this.updateAvailable = false;
    this.downloadProgress = 0;
    this.availableVersion = null;
    this.currentVersion = null;
    this.updateDownloaded = false;
    this.hasCheckedOnStartup = false;
    this.lastCheckTime = null;
    this._updateInfo = null;
    this._updateFilePath = null;
    
    // Get current version
    try {
      this.currentVersion = app.getVersion() || require('../../../package.json').version;
    } catch (e) {
      this.currentVersion = 'Unknown';
    }
    
    // Configure auto-updater
    this.setupAutoUpdater();
  }

  /**
   * Set up Squirrel.Windows auto-updater
   */
  setupAutoUpdater() {
    // Set the GitHub repository as the update source
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'jaydenrussell',
      repo: 'Sip-Toast'
    });
    
    // Auto-download updates when available (silent background download)
    // This is how Discord/Teams work - download first, ask later
    autoUpdater.autoDownload = true;
    
    // Auto-install on app quit - this is the key to Discord/Teams-style updates
    // The update is applied when the app naturally quits (user closes it)
    autoUpdater.autoInstallOnAppQuit = true;
    
    // Don't allow downgrades
    autoUpdater.allowDowngrade = false;
    
    // Enable differential downloads (smaller updates)
    autoUpdater.disableDifferentialDownload = false;
    
    // Log the feed URL for debugging
    logger.info('📦 Update feed URL configured for GitHub releases');
    logger.info(`📦 Current version: v${this.currentVersion}`);
    
    // Event: Checking for update
    autoUpdater.on('checking-for-update', () => {
      logger.info('🔄 Checking for updates...');
      this.isChecking = true;
      this.emitStatus();
    });
    
    // Event: Update available - download silently (Discord/Teams style)
    autoUpdater.on('update-available', (info) => {
      logger.info(`📥 Update found: v${info.version} - downloading silently in background...`);
      this._updateInfo = info;
      this.availableVersion = info.version;
      this.isChecking = false;
      this.isDownloading = true;
      this.downloadProgress = 0;
      this.emitStatus();
    });
    
    // Event: No update available
    autoUpdater.on('update-not-available', (info) => {
      logger.info(`✅ App is up to date (v${info.version})`);
      this._updateInfo = null;
      this.updateAvailable = false;
      this.isChecking = false;
      this.isDownloading = false;
      this.lastCheckTime = new Date();
      this.emitStatus();
    });
    
    // Event: Download progress
    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent);
      const transferred = Math.round(progress.transferred / 1024 / 1024); // MB
      const total = Math.round(progress.total / 1024 / 1024); // MB
      
      if (percent % 10 === 0 || percent === 100) {
        logger.info(`📥 Downloading update: ${percent}% (${transferred}MB / ${total}MB)`);
      }
      this.downloadProgress = percent;
      this.emitStatus();
    });
    
    // Event: Update downloaded and ready
    // Discord/Teams: Show subtle notification, apply on next restart
    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`✅ Update downloaded: v${info.version} - will install on next restart`);
      this.updateDownloaded = true;
      this.updateAvailable = true;
      this.isDownloading = false;
      this.downloadProgress = 100;
      this.availableVersion = info.version;
      this.lastCheckTime = new Date();
      this.emitStatus();
      
      // Discord/Teams style: Log that update will be applied on restart
      // No forced restart - user continues using the app
      logger.info('📌 Update will be applied automatically when you restart the app');
    });
    
    // Event: Error
    autoUpdater.on('error', (error) => {
      logger.error(`❌ Update error: ${error.message}`);
      this.isChecking = false;
      this.isDownloading = false;
      this.emitStatus();
    });
  }

  /**
   * Emit current status to listeners
   */
  emitStatus() {
    this.emit('update-status', this.getStatus());
  }

  /**
   * Check for updates (Discord/Teams-style: silent background check)
   */
  async checkForUpdates() {
    if (this.isChecking || this.isDownloading) {
      logger.debug('Update check/download already in progress');
      return this.getStatus();
    }

    if (!app.isPackaged) {
      logger.debug('Skipping update check in development mode');
      return this.getStatus();
    }

    try {
      this.isChecking = true;
      this.emitStatus();
      
      logger.info(`🔍 Checking GitHub for updates... (current: v${this.currentVersion})`);
      
      // This triggers the autoUpdater events
      // autoDownload is true, so it will download automatically if available
      const result = await autoUpdater.checkForUpdates();
      
      if (result) {
        logger.info(`📦 Update check result: ${result.updateInfo ? `v${result.updateInfo.version}` : 'no update'}`);
      }
      
      return this.getStatus();
    } catch (error) {
      logger.error(`Update check failed: ${error.message}`);
      this.isChecking = false;
      this.emitStatus();
      return this.getStatus();
    }
  }

  /**
   * Get current update status
   */
  getStatus() {
    return {
      checking: this.isChecking,
      downloading: this.isDownloading,
      updateAvailable: this.updateAvailable,
      updateDownloaded: this.updateDownloaded,
      downloadProgress: this.downloadProgress,
      availableVersion: this.availableVersion,
      currentVersion: this.currentVersion,
      lastCheckTime: this.lastCheckTime
    };
  }

  /**
   * Start automatic update checking (Discord/Teams-style)
   * - Check at app startup (after delay, only once)
   * - Download silently in background
   * - Apply on next app restart
   */
  startAutoCheck() {
    if (this.hasCheckedOnStartup) {
      return;
    }
    
    // Check at startup (delayed to let app fully load)
    // Discord waits about 30 seconds, Teams waits about 10 seconds
    setTimeout(() => {
      if (!this.hasCheckedOnStartup) {
        this.hasCheckedOnStartup = true;
        logger.info('🔄 Checking for updates at startup (silent background check)...');
        this.checkForUpdates();
      }
    }, 30000); // 30 second delay like Discord
    
    logger.info(`📅 Auto-update check scheduled (30s delay at startup)`);
  }

  /**
   * Quit and install update immediately
   * This is called when user clicks "Install Update" button
   * Uses Squirrel.Windows Update.exe
   */
  quitAndInstall() {
    if (!this.updateDownloaded) {
      logger.warn('No update downloaded to install');
      return;
    }
    
    logger.info('🔄 Quitting and installing update...');
    
    // Squirrel.Windows will:
    // 1. Close the app
    // 2. Run Update.exe to apply the update
    // 3. Restart the app with the new version
    autoUpdater.quitAndInstall();
  }

  /**
   * Check if Update.exe exists (Squirrel.Windows updater)
   * This is the actual updater executable that handles the update process
   */
  static getUpdateExePath() {
    // Squirrel.Windows places Update.exe in the app's parent directory
    // Typical path: %LocalAppData%\SIPToast\Update.exe
    
    const appFolder = path.dirname(app.getAppPath());
    const possiblePaths = [
      path.join(appFolder, 'Update.exe'),
      path.resolve(appFolder, '..', 'Update.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'SIPToast', 'Update.exe'),
    ];
    
    for (const updateExe of possiblePaths) {
      if (fs.existsSync(updateExe)) {
        logger.debug(`Found Update.exe at: ${updateExe}`);
        return updateExe;
      }
    }
    
    logger.debug('Update.exe not found - app may not be installed via Squirrel');
    return null;
  }

  /**
   * Check if this is a Squirrel.Windows installation
   */
  static isSquirrelInstall() {
    return UpdateService.getUpdateExePath() !== null;
  }

  /**
   * Get the app installation directory
   */
  static getInstallDir() {
    // Squirrel installs to: %LocalAppData%\SIPToast\
    const updateExe = UpdateService.getUpdateExePath();
    if (updateExe) {
      return path.dirname(updateExe);
    }
    return null;
  }
}

module.exports = UpdateService;