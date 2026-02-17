const { logger } = require('./logger');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

/**
 * Squirrel.Windows Auto-Updater Service
 * 
 * Update Flow (similar to Teams/Discord):
 * 1. Check for updates at app startup (once)
 * 2. Download updates silently in background
 * 3. Install automatically when app quits
 * 4. Show subtle indicators in tray
 */
class UpdateService extends EventEmitter {
  constructor() {
    super();
    
    // State
    this.isChecking = false;
    this.updateAvailable = false;
    this.downloadProgress = 0;
    this.availableVersion = null;
    this.currentVersion = null;
    this.updateDownloaded = false;
    this.hasCheckedOnStartup = false;
    
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
    
    // Event: Update available
    autoUpdater.on('update-available', (info) => {
      logger.info(`📥 Update available: v${info.version}`);
      this.updateAvailable = true;
      this.availableVersion = info.version;
      this.isChecking = false;
      this.emitStatus();
    });
    
    // Event: No update available
    autoUpdater.on('update-not-available', (info) => {
      logger.info(`✅ App is up to date (v${info.version})`);
      this.updateAvailable = false;
      this.isChecking = false;
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
    
    // Event: Update downloaded and ready
    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`✅ Update downloaded: v${info.version} - will install on restart`);
      this.updateDownloaded = true;
      this.downloadProgress = 100;
      this.emitStatus();
    });
    
    // Event: Error
    autoUpdater.on('error', (error) => {
      logger.error(`❌ Update error: ${error.message}`);
      this.isChecking = false;
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
   * Check for updates
   * Called automatically at startup
   */
  async checkForUpdates() {
    if (this.isChecking) {
      logger.debug('Update check already in progress');
      return this.getStatus();
    }

    if (!app.isPackaged) {
      logger.debug('Skipping update check in development mode');
      // In development, simulate an update check for testing
      this.currentVersion = '0.0.0'; // Force update available in dev
      return this.getStatus();
    }

    try {
      this.isChecking = true;
      this.emitStatus();
      
      logger.info(`🔍 Checking GitHub for updates... (current: v${this.currentVersion})`);
      
      // This triggers the autoUpdater events
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
   */
  getStatus() {
    return {
      checking: this.isChecking,
      updateAvailable: this.updateAvailable,
      updateDownloaded: this.updateDownloaded,
      downloadProgress: this.downloadProgress,
      availableVersion: this.availableVersion,
      currentVersion: this.currentVersion
    };
  }

  /**
   * Start automatic update checking
   * - Check at app startup (after 30 second delay, only once)
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
        logger.info('🔄 Checking for updates at startup...');
        this.checkForUpdates();
      }
    }, 30000); // 30 second delay
    
    logger.info(`📅 Auto-update check scheduled (30s delay at startup only)`);
  }

  /**
   * Quit and install update immediately
   */
  quitAndInstall() {
    if (!this.updateDownloaded) {
      logger.warn('No update downloaded to install');
      return;
    }
    
    logger.info('🔄 Quitting and installing update...');
    autoUpdater.quitAndInstall();
  }
}

module.exports = UpdateService;