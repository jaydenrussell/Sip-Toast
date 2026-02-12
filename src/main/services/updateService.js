const { autoUpdater } = require('electron-updater');
const { logger } = require('./logger');
const settings = require('../settings');
const { EventEmitter } = require('events');

class UpdateService extends EventEmitter {
  constructor() {
    super();
    this.updateCheckInterval = null;
    this.isChecking = false;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    this.downloadProgress = 0;
    this.availableVersion = null;
    this.currentVersion = null;
    
    // Configure autoUpdater to use GitHub releases
    autoUpdater.autoDownload = false; // We'll handle downloads manually
    autoUpdater.autoInstallOnAppQuit = true;
    
    // Set the feed URL to use GitHub releases
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'jaydenrussell',
      repo: 'Sip-Toast'
    });
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Get current version
    try {
      this.currentVersion = require('../../../package.json').version;
    } catch (e) {
      this.currentVersion = 'Unknown';
    }
  }

  setupEventListeners() {
    autoUpdater.on('checking-for-update', () => {
      logger.info('🔍 Checking for updates...');
      this.isChecking = true;
      this.emitStatus();
    });

    autoUpdater.on('update-available', (info) => {
      logger.info(`✅ Update available: ${info.version}`);
      this.updateAvailable = true;
      this.updateDownloaded = false;
      this.availableVersion = info.version;
      this.isChecking = false;
      this.emitStatus();
    });

    autoUpdater.on('update-not-available', (info) => {
      logger.info(`ℹ️ No update available. Current version: ${info.version}`);
      this.updateAvailable = false;
      this.updateDownloaded = false;
      this.availableVersion = null;
      this.isChecking = false;
      this.emitStatus();
    });

    autoUpdater.on('error', (err) => {
      logger.error(`❌ Update error: ${err.message}`);
      this.isChecking = false;
      this.emitStatus();
    });

    autoUpdater.on('download-progress', (progressObj) => {
      const percent = Math.round(progressObj.percent);
      this.downloadProgress = percent;
      logger.info(`📥 Download progress: ${percent}%`);
      this.emitStatus();
    });

    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`✅ Update downloaded: ${info.version}`);
      this.updateDownloaded = true;
      this.updateAvailable = false;
      this.downloadProgress = 100;
      this.emitStatus();
    });
  }

  /**
   * Emit status to all listeners
   */
  emitStatus() {
    this.emit('update-status', this.getStatus());
  }

  /**
   * Check for updates on app load (called automatically)
   */
  async checkOnAppLoad() {
    const updateSettings = settings.get('updates', {});
    
    // Don't check if updates are disabled
    if (!updateSettings.enabled) {
      logger.info('⏸️ Auto-update is disabled, skipping initial check');
      return;
    }
    
    // Don't check if frequency is 'never'
    if (updateSettings.checkFrequency === 'never') {
      logger.info('⏸️ Auto-update check frequency is set to never, skipping initial check');
      return;
    }

    logger.info('🔄 Checking for updates on app load...');
    
    try {
      await this.checkForUpdates();
    } catch (error) {
      logger.error(`❌ Initial update check failed: ${error.message}`);
    }
  }

  /**
   * Check for updates manually
   */
  async checkForUpdates(force = false) {
    if (this.isChecking && !force) {
      logger.warn('⚠️ Update check already in progress');
      return { checking: true };
    }

    try {
      this.isChecking = true;
      this.emitStatus();
      
      // Update last check time
      const updateSettings = settings.get('updates', {});
      updateSettings.lastCheckTime = new Date().toISOString();
      settings.set('updates', updateSettings);
      
      const result = await autoUpdater.checkForUpdates();
      const updateAvailable = !!(result && result.updateInfo);
      const version = result?.updateInfo?.version || null;
      this.updateAvailable = updateAvailable;
      this.availableVersion = version;
      this.isChecking = false;
      this.emitStatus();
      return {
        checking: false,
        updateAvailable,
        version
      };
    } catch (error) {
      logger.error(`❌ Failed to check for updates: ${error.message}`);
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
      this.emitStatus();
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (error) {
      logger.error(`❌ Failed to download update: ${error.message}`);
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

    try {
      logger.info('🚀 Installing update and restarting...');
      autoUpdater.quitAndInstall(false, true);
      return { success: true };
    } catch (error) {
      logger.error(`❌ Failed to install update: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get update status
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
   * Start automatic update checking based on frequency
   */
  startAutoCheck() {
    // Clear any existing interval
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }

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
    
    logger.info(`🔄 Auto-update check scheduled: ${updateSettings.checkFrequency} (every ${intervalMs / 1000 / 60 / 60} hours)`);

    // Check immediately on app load (with a small delay to let app start)
    setTimeout(() => {
      this.checkOnAppLoad();
    }, 5000); // Wait 5 seconds after app start

    // Set up periodic checking
    this.updateCheckInterval = setInterval(() => {
      logger.info(`🔄 Periodic update check (${updateSettings.checkFrequency})`);
      this.checkForUpdates().catch(err => {
        logger.error(`Failed to check for updates: ${err.message}`);
      });
    }, intervalMs);
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
   * Restart auto-check (useful when settings change)
   */
  restartAutoCheck() {
    this.stopAutoCheck();
    this.startAutoCheck();
  }

  /**
   * Check if there's an update ready (for tray icon)
   */
  hasUpdateReady() {
    return this.updateAvailable || this.updateDownloaded;
  }
}

module.exports = UpdateService;
