const { logger } = require('./logger');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');

/**
 * Squirrel.Windows Auto-Updater Service (Discord-style)
 * 
 * Update Flow (exactly like Discord):
 * 1. Check for updates at app startup (silent background check)
 * 2. Download updates silently in background
 * 3. Only notify user when update is READY to install
 * 4. On manual check: download first, then show "update available" only when downloaded
 * 5. Install automatically when app quits
 * 
 * Key differences from before:
 * - Never show "update available" until download is complete
 * - Manual check downloads silently first
 * - Uses Squirrel.Windows Update.exe for the actual update
 */
class UpdateService extends EventEmitter {
  constructor() {
    super();
    
    // State
    this.isChecking = false;
    this.isDownloading = false;
    this.updateAvailable = false;  // Only true when DOWNLOADED
    this.downloadProgress = 0;
    this.availableVersion = null;
    this.currentVersion = null;
    this.updateDownloaded = false;
    this.hasCheckedOnStartup = false;
    this.lastCheckTime = null;
    this._updateInfo = null;  // Store update info but don't expose until downloaded
    
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
    autoUpdater.autoDownload = true;
    
    // Auto-install on app quit (seamless update experience)
    autoUpdater.autoInstallOnAppQuit = true;
    
    // Don't allow downgrades
    autoUpdater.allowDowngrade = false;
    
    // Log the feed URL for debugging
    logger.info('📦 Update feed URL configured for GitHub releases');
    
    // Event: Checking for update
    autoUpdater.on('checking-for-update', () => {
      logger.info('🔄 Checking for updates...');
      this.isChecking = true;
      this.emitStatus();
    });
    
    // Event: Update available - DON'T notify yet, download silently
    autoUpdater.on('update-available', (info) => {
      logger.info(`📥 Update found: v${info.version} - downloading silently...`);
      this._updateInfo = info;  // Store but don't expose
      this.availableVersion = info.version;
      this.isChecking = false;
      this.isDownloading = true;
      this.downloadProgress = 0;
      // Don't set updateAvailable = true yet! Wait for download.
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
      if (percent % 10 === 0 || percent === 100) { // Log every 10%
        logger.info(`📥 Downloading update: ${percent}%`);
      }
      this.downloadProgress = percent;
      this.emitStatus();
    });
    
    // Event: Update downloaded and ready - NOW notify user
    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`✅ Update downloaded: v${info.version} - ready to install`);
      this.updateDownloaded = true;
      this.updateAvailable = true;  // NOW we can show it
      this.isDownloading = false;
      this.downloadProgress = 100;
      this.availableVersion = info.version;
      this.lastCheckTime = new Date();
      this.emitStatus();
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
   * Check for updates (Discord-style: silent download first)
   * Called automatically at startup
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
        logger.info(`📦 Update check result: ${result.updateInfo ? `v${result.updateInfo.version}` : 'no info'}`);
      }
      
      return this.getStatus();
    } catch (error) {
      logger.error(`Update check failed: ${error.message}`);
      logger.error(`Stack trace: ${error.stack}`);
      this.isChecking = false;
      this.emitStatus();
      return this.getStatus();
    }
  }

  /**
   * Get current update status
   * Note: updateAvailable is only true when the update is DOWNLOADED and ready
   */
  getStatus() {
    return {
      checking: this.isChecking,
      downloading: this.isDownloading,
      updateAvailable: this.updateAvailable,  // Only true when downloaded
      updateDownloaded: this.updateDownloaded,
      downloadProgress: this.downloadProgress,
      availableVersion: this.availableVersion,
      currentVersion: this.currentVersion,
      lastCheckTime: this.lastCheckTime
    };
  }

  /**
   * Start automatic update checking (Discord-style)
   * - Check at app startup (after 30 second delay, only once)
   * - Download silently in background
   * - Only notify when ready
   */
  startAutoCheck() {
    // Only check once at startup
    if (this.hasCheckedOnStartup) {
      return;
    }
    
    // Check at startup (delayed to let app fully load)
    setTimeout(() => {
      if (!this.hasCheckedOnStartup) {
        this.hasCheckedOnStartup = true;
        logger.info('🔄 Checking for updates at startup (silent background check)...');
        this.checkForUpdates();
      }
    }, 30000); // 30 second delay
    
    logger.info(`📅 Auto-update check scheduled (30s delay at startup only)`);
  }

  /**
   * Quit and install update immediately
   * Uses Squirrel.Windows Update.exe
   */
  quitAndInstall() {
    if (!this.updateDownloaded) {
      logger.warn('No update downloaded to install');
      return;
    }
    
    logger.info('🔄 Quitting and installing update...');
    
    // Squirrel.Windows will handle the update via Update.exe
    autoUpdater.quitAndInstall();
  }

  /**
   * Check if Update.exe exists (Squirrel.Windows updater)
   */
  static getUpdateExePath() {
    // Squirrel.Windows places Update.exe in the app's parent directory
    const appFolder = path.dirname(app.getAppPath());
    const updateExe = path.join(appFolder, 'Update.exe');
    
    if (fs.existsSync(updateExe)) {
      return updateExe;
    }
    
    // Alternative location for some Squirrel installations
    const altUpdateExe = path.resolve(appFolder, '..', 'Update.exe');
    if (fs.existsSync(altUpdateExe)) {
      return altUpdateExe;
    }
    
    return null;
  }
}

module.exports = UpdateService;