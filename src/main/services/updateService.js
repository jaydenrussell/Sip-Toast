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
      const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;
      logger.info(`📡 Fetching latest release from: ${apiUrl}`);
      
      const response = await axios.get(apiUrl, {
        headers: {
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'SIP-Toast'
        }
      });
      
      // Log detailed response info
      logger.info(`📥 GitHub API Response:`);
      logger.info(`   - Tag name: ${response.data.tag_name}`);
      logger.info(`   - Release name: ${response.data.name || 'N/A'}`);
      logger.info(`   - Published: ${response.data.published_at || 'N/A'}`);
      logger.info(`   - Assets count: ${response.data.assets?.length || 0}`);
      
      if (response.data.assets && response.data.assets.length > 0) {
        logger.info(`   - Available assets:`);
        response.data.assets.forEach(asset => {
          logger.info(`     * ${asset.name} (${asset.size} bytes)`);
        });
      }
      
      return response.data;
    } catch (error) {
      logger.error(`❌ Failed to fetch GitHub release: ${error.message}`);
      
      // Log more details about the error
      if (error.response) {
        logger.error(`   Status: ${error.response.status}`);
        logger.error(`   Status text: ${error.response.statusText}`);
        logger.error(`   Response data: ${JSON.stringify(error.response.data).substring(0, 200)}`);
      } else if (error.request) {
        logger.error(`   No response received from GitHub API`);
      }
      
      throw error;
    }
  }

  /**
   * Check for updates on app load (called automatically)
   * Only checks once on app load, not periodically
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

    // Check if we've already checked on this app session
    if (this.hasCheckedOnLoad) {
      logger.info('⏸️ Already checked for updates on this app load, skipping');
      return;
    }

    logger.info('🔄 Checking for updates on app load...');
    
    // Import and log the update check event
    const { logUpdateCheck } = require('./eventLogger');
    logUpdateCheck('app_load');
    
    try {
      await this.checkForUpdates();
      this.hasCheckedOnLoad = true; // Mark as checked
    } catch (error) {
      logger.error(`❌ Initial update check failed: ${error.message}`);
      
      // Log the error
      const { logUpdateError } = require('./eventLogger');
      logUpdateError(error.message, 'app_load_check');
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
      
      logger.info('🔍 ===============================================');
      logger.info('🔍 Starting update check...');
      logger.info(`🔍 Current version: ${this.currentVersion}`);
      logger.info('🔍 ===============================================');
      
      const release = await this.fetchLatestRelease();
      
      // Extract version from tag name (remove 'v' prefix if present)
      const latestVersion = release.tag_name.startsWith('v') 
        ? release.tag_name.substring(1) 
        : release.tag_name;
      
      logger.info(`🔍 Version comparison:`);
      logger.info(`   Current version: ${this.currentVersion}`);
      logger.info(`   Latest version:   ${latestVersion}`);
      
      // Compare versions
      const currentVer = this.currentVersion.replace(/^v/, '');
      const comparisonResult = this.compareVersions(latestVersion, currentVer);
      const isNewer = comparisonResult > 0;
      
      logger.info(`   Comparison result: ${comparisonResult > 0 ? 'Newer available' : comparisonResult < 0 ? 'Current is newer' : 'Versions equal'}`);
      logger.info(`   Update needed: ${isNewer ? 'YES' : 'NO'}`);
      
      if (isNewer) {
        // Find MSI file in release assets
        const allAssets = release.assets || [];
        logger.info(`🔍 Looking for MSI file in ${allAssets.length} assets...`);
        
        const msiAsset = allAssets.find(asset => 
          asset.name.toLowerCase().endsWith('.msi')
        );
        
        if (msiAsset) {
          this.updateAvailable = true;
          this.availableVersion = latestVersion;
          this.downloadUrl = msiAsset.browser_download_url;
          this.downloadFileName = msiAsset.name;
          logger.info(`✅ ===============================================`);
          logger.info(`✅ UPDATE AVAILABLE: v${latestVersion}`);
          logger.info(`   File: ${msiAsset.name}`);
          logger.info(`   Size: ${(msiAsset.size / 1024 / 1024).toFixed(2)} MB`);
          logger.info(`   URL:  ${this.downloadUrl}`);
          logger.info(`✅ ===============================================`);
          
          // Log update available event
          const { logUpdateAvailable } = require('./eventLogger');
          logUpdateAvailable(latestVersion, this.downloadUrl);
        } else {
          logger.warn(`⚠️ No MSI file found in release assets!`);
          logger.warn(`   Available files:`);
          allAssets.forEach(asset => {
            logger.warn(`   - ${asset.name} (${(asset.size / 1024).toFixed(1)} KB)`);
          });
          this.updateAvailable = false;
          this.availableVersion = null;
        }
      } else {
        logger.info(`ℹ️ ===============================================`);
        logger.info(`ℹ️ NO UPDATE AVAILABLE`);
        logger.info(`   Current version: ${currentVer} is up to date`);
        logger.info(`   Latest release:   v${latestVersion}`);
        logger.info(`ℹ️ ===============================================`);
        this.updateAvailable = false;
        this.availableVersion = null;
        
        // Log that we're up to date
        const { logUpdateCheck } = require('./eventLogger');
        logUpdateCheck('check_complete_up_to_date');
      }
      
      this.isChecking = false;
      this.emitStatus();
      
      logger.info(`🔍 Update check complete. Available: ${this.updateAvailable}`);
      
      return {
        checking: false,
        updateAvailable: this.updateAvailable,
        version: this.availableVersion
      };
    } catch (error) {
      logger.error(`❌ ===============================================`);
      logger.error(`❌ UPDATE CHECK FAILED`);
      logger.error(`   Error: ${error.message}`);
      logger.error(`❌ ===============================================`);
      
      // Log the error
      const { logUpdateError } = require('./eventLogger');
      logUpdateError(error.message, 'checkForUpdates');
      
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
   * Shows download progress, then launches helper to close app, install, and restart
   */
  async downloadAndInstall() {
    if (!this.updateAvailable || !this.downloadUrl) {
      throw new Error('No update available to download');
    }

    let startTime = Date.now();
    let lastLoaded = 0;
    let lastTime = startTime;
    let downloadSpeed = 0;

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
          
          // Calculate download speed
          const now = Date.now();
          const timeDiff = now - lastTime;
          if (timeDiff >= 500) { // Update speed every 500ms
            const loadedDiff = progressEvent.loaded - lastLoaded;
            downloadSpeed = Math.round(loadedDiff / (timeDiff / 1000) / 1024); // KB/s
            lastLoaded = progressEvent.loaded;
            lastTime = now;
          }
          
          logger.info(`📥 Download progress: ${percent}% (${downloadSpeed} KB/s)`);
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
          const downloadTime = Math.round((Date.now() - startTime) / 1000);
          logger.info(`✅ Download complete: ${filePath} (took ${downloadTime}s)`);
          this.downloadProgress = 100;
          this.emitStatus();
          
          // Log downloaded event
          const { logUpdateDownloaded } = require('./eventLogger');
          logUpdateDownloaded(this.availableVersion, filePath);
          
          // Now launch the update helper to close app, install, and restart
          try {
            logger.info('🚀 Launching update helper...');
            
            // Get the helper path
            let helperPath;
            if (app.isPackaged) {
              helperPath = path.join(process.resourcesPath, 'update-helper.bat');
            } else {
              helperPath = path.join(__dirname, '..', '..', 'scripts', 'update-helper.bat');
            }
            
            // Get app executable path
            const appPath = app.isPackaged ? process.execPath : null;
            
            // Launch helper - it will:
            // 1. Kill the main app process
            // 2. Install the MSI with UI (shows progress)
            // 3. Restart the app
            
            const helperArgs = [
              '--msi', filePath
            ];
            
            if (appPath) {
              helperArgs.push('--app', appPath);
            }
            
            const fullArgs = ['/c', helperPath, ...helperArgs];
            logger.info(`   Helper: cmd ${fullArgs.join(' ')}`);
            
            // Run the batch file helper - it will install and restart the app
            // Use cmd /c to run the batch file
            spawn('cmd', fullArgs, {
              detached: true,
              stdio: 'ignore',
              windowsHide: false
            }).unref();
            
            logger.info('🚀 Update helper launched - app will close and restart');
            resolve({ 
              success: true, 
              message: 'Update in progress - app will restart automatically',
              willRestart: true 
            });
            
            // Give user a moment to see the progress before quitting
            setTimeout(() => {
              logger.info('👋 Closing app for update...');
              app.quit();
            }, 3000);
            
          } catch (helperError) {
            logger.error(`❌ Failed to launch update helper: ${helperError.message}`);
            reject(helperError);
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
