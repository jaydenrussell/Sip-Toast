const { logger } = require('./logger');
const settings = require('../settings');
const { EventEmitter } = require('events');
const { app } = require('electron');

// Squirrel.Windows auto-updater from electron-updater
const { autoUpdater } = require('electron-updater');

class UpdateService extends EventEmitter {
  constructor() {
    super();
    this.updateCheckInterval = null;
    this.isChecking = false;
    this.updateAvailable = false;
    this.downloadProgress = 0;
    this.availableVersion = null;
    this.currentVersion = null;
    this.updateDownloaded = false;
    this.lastCheckTime = null;
    
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
   * Set up Squirrel.Windows auto-updater event handlers
   */
  setupAutoUpdater() {
    // Don't auto-download - we want to control when to download
    autoUpdater.autoDownload = false;
    // Auto-install on app quit
    autoUpdater.autoInstallOnAppQuit = true;
    // Allow downgrades (in case we need to rollback)
    autoUpdater.allowDowngrade = false;
    
    // Set up event handlers
    autoUpdater.on('checking-for-update', () => {
      logger.info('🔍 Checking for update...');
      this.isChecking = true;
      this.emitStatus();
    });
    
    autoUpdater.on('update-available', (info) => {
      logger.info(`✅ Update available: v${info.version}`);
      this.updateAvailable = true;
      this.availableVersion = info.version;
      this.isChecking = false;
      this.lastCheckTime = new Date().toISOString();
      this.emitStatus();
      
      // Log update available
      try {
        const { logUpdateAvailable } = require('./eventLogger');
        logUpdateAvailable(info.version, info.releaseNotes);
      } catch (e) {}
    });
    
    autoUpdater.on('update-not-available', (info) => {
      logger.info(`ℹ️ No update available. Current version: ${info.version}`);
      this.updateAvailable = false;
      this.isChecking = false;
      this.lastCheckTime = new Date().toISOString();
      this.emitStatus();
    });
    
    autoUpdater.on('download-progress', (progressObj) => {
      this.downloadProgress = Math.round(progressObj.percent);
      logger.info(`📥 Download progress: ${this.downloadProgress}%`);
      this.emitStatus();
    });
    
    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`✅ Update downloaded: v${info.version}`);
      this.updateDownloaded = true;
      this.downloadProgress = 100;
      this.emitStatus();
      
      // Log update downloaded
      try {
        const { logUpdateDownloaded } = require('./eventLogger');
        logUpdateDownloaded(info.version);
      } catch (e) {}
    });
    
    autoUpdater.on('error', (err) => {
      logger.error(`❌ Update error: ${err.message}`);
      this.isChecking = false;
      this.emitStatus();
      
      // Log update error
      try {
        const { logUpdateError } = require('./eventLogger');
        logUpdateError(err.message, 'autoUpdater');
      } catch (e) {}
    });
  }

  /**
   * Emit status to all listeners
   */
  emitStatus() {
    this.emit('update-status', this.getStatus());
  }

  /**
   * Check for updates using Squirrel.Windows
   */
  async checkForUpdates() {
    if (this.isChecking) {
      logger.warn('⚠️ Update check already in progress');
      return this.getStatus();
    }

    try {
      this.isChecking = true;
      this.emitStatus();
      
      logger.info(`🔍 Checking for updates... (current: v${this.currentVersion})`);
      
      // Check for update - autoUpdater will emit events
      const result = await autoUpdater.checkForUpdates();
      
      // Update last check time in settings
      const updateSettings = settings.get('updates', {});
      updateSettings.lastCheckTime = new Date().toISOString();
      settings.set('updates', updateSettings);
      
      return this.getStatus();
    } catch (error) {
      logger.error(`❌ Update check failed: ${error.message}`);
      this.isChecking = false;
      this.emitStatus();
      throw error;
    }
  }

  /**
   * Download the available update
   */
  async downloadUpdate() {
    if (!this.updateAvailable) {
      throw new Error('No update available to download');
    }

    try {
      logger.info('📥 Starting update download...');
      this.downloadProgress = 0;
      this.emitStatus();
      
      // Download the update - autoUpdater will emit download-progress events
      await autoUpdater.downloadUpdate();
      
      return {
        success: true,
        message: 'Update downloaded successfully'
      };
    } catch (error) {
      logger.error(`❌ Update download failed: ${error.message}`);
      this.emitStatus();
      throw error;
    }
  }

  /**
   * Install the downloaded update and restart
   */
  async installUpdate() {
    if (!this.updateDownloaded) {
      throw new Error('No update downloaded to install');
    }

    logger.info('🚀 Installing update and restarting...');
    
    // Log update installed
    try {
      const { logUpdateInstalled } = require('./eventLogger');
      logUpdateInstalled(this.availableVersion);
    } catch (e) {}
    
    // This will quit the app and install the update
    autoUpdater.quitAndInstall(false, true);
    
    return {
      success: true,
      message: 'Installing update...'
    };
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
      currentVersion: this.currentVersion,
      lastCheckTime: this.lastCheckTime
    };
  }

  /**
   * Start automatic update checking based on settings
   */
  startAutoCheck() {
    // Clear any existing interval
    this.stopAutoCheck();

    const updateSettings = settings.get('updates', {});
    
    // Don't start if updates are disabled
    if (!updateSettings.enabled) {
      logger.info('⏸️ Auto-update is disabled');
      return;
    }

    // Don't start if frequency is 'never'
    if (updateSettings.checkFrequency === 'never') {
      logger.info('⏸️ Auto-update check frequency is set to never');
      return;
    }

    // Calculate interval based on frequency
    const intervals = {
      daily: 24 * 60 * 60 * 1000,      // 24 hours
      weekly: 7 * 24 * 60 * 60 * 1000, // 7 days
      monthly: 30 * 24 * 60 * 60 * 1000 // 30 days
    };

    const intervalMs = intervals[updateSettings.checkFrequency] || intervals.daily;
    
    logger.info(`🔄 Auto-update check scheduled: ${updateSettings.checkFrequency}`);

    // Check on app load (with delay to let app fully start)
    setTimeout(() => {
      this.checkOnAppLoad();
    }, 10000); // Wait 10 seconds after app start

    // Set up periodic checking
    this.updateCheckInterval = setInterval(() => {
      logger.info(`🔄 Periodic update check (${updateSettings.checkFrequency})`);
      this.checkForUpdates().catch(err => {
        logger.error(`Periodic update check failed: ${err.message}`);
      });
    }, intervalMs);
  }

  /**
   * Check for updates on app load
   */
  async checkOnAppLoad() {
    const updateSettings = settings.get('updates', {});
    
    if (!updateSettings.enabled || updateSettings.checkFrequency === 'never') {
      return;
    }

    // Check if we already checked recently (within last hour)
    if (updateSettings.lastCheckTime) {
      const lastCheck = new Date(updateSettings.lastCheckTime);
      const hoursSinceCheck = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);
      if (hoursSinceCheck < 1) {
        logger.info('⏸️ Already checked for updates recently, skipping');
        return;
      }
    }

    logger.info('🔄 Checking for updates on app load...');
    
    try {
      await this.checkForUpdates();
    } catch (error) {
      logger.error(`Initial update check failed: ${error.message}`);
    }
  }

  /**
   * Stop automatic update checking
   */
  stopAutoCheck() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
      logger.info('⏸️ Auto-update checking stopped');
    }
  }

  /**
   * Restart auto-check (when settings change)
   */
  restartAutoCheck() {
    this.stopAutoCheck();
    this.startAutoCheck();
  }
}

module.exports = UpdateService;