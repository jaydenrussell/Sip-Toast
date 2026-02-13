const axios = require('axios');
const { logger } = require('./logger');
const settings = require('../settings');
const { EventEmitter } = require('events');
const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const GITHUB_OWNER = 'jaydenrussell';
const GITHUB_REPO = 'Sip-Toast';

class UpdateService extends EventEmitter {
  constructor() {
    super();
    this.updateCheckInterval = null;
    this.isChecking = false;
    this.updateAvailable = false;
    this.downloadProgress = 0;
    this.availableVersion = null;
    this.downloadUrl = null;
    this.downloadFileName = null;
    this.currentVersion = null;
    
    // Get current version
    try {
      this.currentVersion = require('../../../package.json').version;
    } catch (e) {
      this.currentVersion = 'Unknown';
    }
  }

  /**
   * Emit status to all listeners
   */
  emitStatus() {
    this.emit('update-status', this.getStatus());
  }

  /**
   * Fetch latest release from GitHub API
   */
  async fetchLatestRelease() {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        {
          headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'SIP-Toast'
          }
        }
      );
      return response.data;
    } catch (error) {
      logger.error(`❌ Failed to fetch GitHub release: ${error.message}`);
      throw error;
    }
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
      
      logger.info('🔍 Checking for updates from GitHub...');
      
      const release = await this.fetchLatestRelease();
      
      // Extract version from tag name (remove 'v' prefix if present)
      const latestVersion = release.tag_name.startsWith('v') 
        ? release.tag_name.substring(1) 
        : release.tag_name;
      
      // Compare versions
      const currentVer = this.currentVersion.replace(/^v/, '');
      const isNewer = this.compareVersions(latestVersion, currentVer) > 0;
      
      if (isNewer) {
        // Find MSI file in release assets
        const msiAsset = release.assets.find(asset => 
          asset.name.toLowerCase().endsWith('.msi')
        );
        
        if (msiAsset) {
          this.updateAvailable = true;
          this.availableVersion = latestVersion;
          this.downloadUrl = msiAsset.browser_download_url;
          this.downloadFileName = msiAsset.name;
          logger.info(`✅ Update available: ${latestVersion} (${msiAsset.name})`);
        } else {
          logger.warn('⚠️ No MSI file found in release assets');
          this.updateAvailable = false;
          this.availableVersion = null;
        }
      } else {
        logger.info(`ℹ️ Already on latest version: ${currentVer}`);
        this.updateAvailable = false;
        this.availableVersion = null;
      }
      
      this.isChecking = false;
      this.emitStatus();
      
      return {
        checking: false,
        updateAvailable: this.updateAvailable,
        version: this.availableVersion
      };
    } catch (error) {
      logger.error(`❌ Failed to check for updates: ${error.message}`);
      this.isChecking = false;
      this.emitStatus();
      throw error;
    }
  }

  /**
   * Compare semantic versions
   * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
   */
  compareVersions(v1, v2) {
    const parse = v => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10));
    const p1 = parse(v1);
    const p2 = parse(v2);
    
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      const n1 = p1[i] || 0;
      const n2 = p2[i] || 0;
      if (n1 > n2) return 1;
      if (n1 < n2) return -1;
    }
    return 0;
  }

  /**
   * Download and install the update (Discord-like)
   */
  async downloadAndInstall() {
    if (!this.updateAvailable || !this.downloadUrl) {
      throw new Error('No update available to download');
    }

    try {
      logger.info('📥 Starting update download...');
      this.downloadProgress = 0;
      this.emitStatus();
      
      // Download the MSI file
      const response = await axios({
        method: 'get',
        url: this.downloadUrl,
        responseType: 'stream',
        onDownloadProgress: (progressEvent) => {
          const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          this.downloadProgress = percent;
          logger.info(`📥 Download progress: ${percent}%`);
          this.emitStatus();
        }
      });
      
      // Get temp directory
      const tempDir = app.getPath('temp');
      const filePath = path.join(tempDir, this.downloadFileName);
      
      // Write file
      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      
      return new Promise((resolve, reject) => {
        writer.on('finish', async () => {
          logger.info(`✅ Download complete: ${filePath}`);
          this.downloadProgress = 100;
          this.emitStatus();
          
          // Install the MSI silently
          try {
            logger.info('🚀 Installing update...');
            
            // Use msiexec to install silently
            const installArgs = [
              '/i',
              filePath,
              '/quiet',
              '/norestart',
              '/log',
              path.join(tempDir, 'sip-toast-install.log')
            ];
            
            spawn('msiexec.exe', installArgs, {
              detached: true,
              stdio: 'ignore'
            }).unref();
            
            logger.info('🚀 Update installer started');
            resolve({ success: true, message: 'Update installer started' });
          } catch (installError) {
            logger.error(`❌ Failed to install update: ${installError.message}`);
            reject(installError);
          }
        });
        
        writer.on('error', (err) => {
          logger.error(`❌ Failed to write update file: ${err.message}`);
          reject(err);
        });
      });
    } catch (error) {
      logger.error(`❌ Failed to download update: ${error.message}`);
      this.emitStatus();
      throw error;
    }
  }

  /**
   * Open download page in browser (fallback)
   */
  async openDownloadPage() {
    if (!this.availableVersion) {
      throw new Error('No update available');
    }
    
    const url = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tag/v${this.availableVersion}`;
    await shell.openExternal(url);
    return { success: true };
  }

  /**
   * Get update status
   */
  getStatus() {
    return {
      checking: this.isChecking,
      updateAvailable: this.updateAvailable,
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
    return this.updateAvailable;
  }
}

module.exports = UpdateService;
