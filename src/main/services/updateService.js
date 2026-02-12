const { autoUpdater } = require('electron-updater');
const { logger } = require('./logger');
const settings = require('../settings');
const https = require('https');

class UpdateService {
  constructor() {
    this.updateCheckInterval = null;
    this.isChecking = false;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    
    // Configure autoUpdater
    autoUpdater.autoDownload = false; // We'll handle downloads manually
    autoUpdater.autoInstallOnAppQuit = true;
    
    // GitHub repository configuration
    this.githubConfig = {
      owner: 'jaydenrussell',
      repo: 'Sip-Toast',
      apiUrl: 'https://api.github.com',
      releasesUrl: 'https://github.com/jaydenrussell/Sip-Toast/releases'
    };
    
    // Set up event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    autoUpdater.on('checking-for-update', () => {
      logger.info('🔍 Checking for updates...');
      this.isChecking = true;
    });

    autoUpdater.on('update-available', (info) => {
      logger.info(`✅ Update available: ${info.version}`);
      this.updateAvailable = true;
      this.isChecking = false;
    });

    autoUpdater.on('update-not-available', (info) => {
      logger.info(`ℹ️ No update available. Current version: ${info.version}`);
      this.updateAvailable = false;
      this.isChecking = false;
    });

    autoUpdater.on('error', (err) => {
      logger.error(`❌ Update error: ${err.message}`);
      this.isChecking = false;
    });

    autoUpdater.on('download-progress', (progressObj) => {
      const percent = Math.round(progressObj.percent);
      logger.info(`📥 Download progress: ${percent}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`✅ Update downloaded: ${info.version}`);
      this.updateDownloaded = true;
      this.updateAvailable = false;
    });
  }

  /**
   * Get the latest release information from GitHub API
   */
  async getLatestReleaseFromGitHub() {
    return new Promise((resolve, reject) => {
      const url = `${this.githubConfig.apiUrl}/repos/${this.githubConfig.owner}/${this.githubConfig.repo}/releases/latest`;
      
      const options = {
        headers: {
          'User-Agent': 'SIP-Toast-Update-Service',
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      const request = https.request(url, options, (response) => {
        let data = '';
        
        response.on('data', (chunk) => {
          data += chunk;
        });
        
        response.on('end', () => {
          try {
            if (response.statusCode === 200) {
              const release = JSON.parse(data);
              resolve({
                version: release.tag_name.replace('v', ''), // Remove 'v' prefix if present
                name: release.name,
                body: release.body,
                publishedAt: release.published_at,
                htmlUrl: release.html_url,
                assets: release.assets || []
              });
            } else {
              reject(new Error(`GitHub API returned status ${response.statusCode}: ${data}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse GitHub API response: ${error.message}`));
          }
        });
      });

      request.on('error', (error) => {
        reject(new Error(`GitHub API request failed: ${error.message}`));
      });

      request.setTimeout(10000, () => {
        request.destroy();
        reject(new Error('GitHub API request timed out'));
      });

      request.end();
    });
  }

  /**
   * Get current application version
   */
  getCurrentVersion() {
    try {
      const packageJson = require('../../../package.json');
      return packageJson.version || 'Unknown';
    } catch (error) {
      logger.error(`Failed to get current version: ${error.message}`);
      return 'Unknown';
    }
  }

  /**
   * Compare versions (semantic versioning)
   */
  compareVersions(current, latest) {
    if (!current || !latest) return 0;
    
    // Remove 'v' prefix if present
    const cleanCurrent = current.replace('v', '');
    const cleanLatest = latest.replace('v', '');
    
    const currentParts = cleanCurrent.split('.').map(Number);
    const latestParts = cleanLatest.split('.').map(Number);
    
    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
      const currentPart = currentParts[i] || 0;
      const latestPart = latestParts[i] || 0;
      
      if (currentPart < latestPart) return -1;
      if (currentPart > latestPart) return 1;
    }
    
    return 0;
  }

  /**
   * Check for updates using GitHub API as fallback
   */
  async checkForUpdatesWithGitHub() {
    try {
      logger.info('🔍 Checking for updates via GitHub API...');
      const latestRelease = await this.getLatestReleaseFromGitHub();
      const currentVersion = this.getCurrentVersion();
      
      logger.info(`📦 Current version: ${currentVersion}`);
      logger.info(`📦 Latest version: ${latestRelease.version}`);
      
      const versionComparison = this.compareVersions(currentVersion, latestRelease.version);
      
      if (versionComparison < 0) {
        logger.info(`✅ Update available: ${latestRelease.version}`);
        // Update internal state to match the result
        this.updateAvailable = true;
        this.isChecking = false;
        return {
          updateAvailable: true,
          version: latestRelease.version,
          name: latestRelease.name,
          body: latestRelease.body,
          publishedAt: latestRelease.publishedAt,
          htmlUrl: latestRelease.html_url,
          assets: latestRelease.assets,
          message: `Update available: ${latestRelease.version}`
        };
      } else {
        logger.info(`ℹ️ No update available. Current version is up to date.`);
        // Update internal state to match the result
        this.updateAvailable = false;
        this.isChecking = false;
        return {
          updateAvailable: false,
          version: currentVersion,
          message: 'You are using the latest version.'
        };
      }
    } catch (error) {
      logger.error(`❌ GitHub update check failed: ${error.message}`);
      // Update internal state to reflect error state
      this.isChecking = false;
      // Return error without throwing - caller handles gracefully
      return {
        updateAvailable: false,
        error: error.message,
        message: 'Failed to check for updates via GitHub API'
      };
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
      this.updateAvailable = false;
      this.updateDownloaded = false;
      
      // Update last check time
      const updateSettings = settings.get('updates', {});
      updateSettings.lastCheckTime = new Date().toISOString();
      settings.set('updates', updateSettings);
      
      // First try GitHub API for more reliable results
      const githubResult = await this.checkForUpdatesWithGitHub();
      
      if (githubResult.error && !githubResult.updateAvailable) {
        // GitHub API failed completely, fall back to electron-updater
        logger.warn(`GitHub API failed: ${githubResult.error}, falling back to electron-updater`);
        try {
          const result = await autoUpdater.checkForUpdates();
          const updateAvailable = !!(result && result.updateInfo);
          const version = result?.updateInfo?.version || null;
          this.updateAvailable = updateAvailable;
          this.isChecking = false;
          return {
            checking: false,
            updateAvailable,
            version
          };
        } catch (updaterError) {
          // electron-updater also failed
          logger.error(`electron-updater failed: ${updaterError.message}`);
          this.isChecking = false;
          return {
            checking: false,
            updateAvailable: false,
            error: `Both GitHub API and electron-updater failed: ${updaterError.message}`
          };
        }
      }
      
      if (githubResult.updateAvailable) {
        // GitHub found an update, set internal state and return success
        logger.info(`✅ Update available from GitHub: ${githubResult.version}`);
        this.updateAvailable = true;
        this.isChecking = false;
        return {
          checking: false,
          updateAvailable: true,
          version: githubResult.version,
          message: githubResult.message
        };
      }
      
      // No update available from GitHub
      logger.info(`ℹ️ No update available. Current version is up to date.`);
      this.updateAvailable = false;
      this.isChecking = false;
      return {
        checking: false,
        updateAvailable: false,
        version: this.getCurrentVersion(),
        message: 'You are using the latest version.'
      };
    } catch (error) {
      logger.error(`❌ Failed to check for updates: ${error.message}`);
      this.isChecking = false;
      return {
        checking: false,
        updateAvailable: false,
        error: error.message
      };
    }
  }

  /**
   * Download the available update
   */
  async downloadUpdate() {
    if (!this.updateAvailable && !this.updateDownloaded) {
      throw new Error('Please check for updates first');
    }

    try {
      // Set up feed URL before downloading
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: this.githubConfig.owner,
        repo: this.githubConfig.repo,
        releaseType: 'release'
      });
      
      logger.info('📥 Starting update download...');
      await autoUpdater.downloadUpdate();
      this.updateDownloaded = true;
      this.updateAvailable = false;
      return { success: true };
    } catch (error) {
      logger.error(`❌ Failed to download update: ${error.message}`);
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  /**
   * Install the downloaded update and restart
   */
  async installUpdate() {
    if (!this.updateDownloaded) {
      throw new Error('No update has been downloaded yet. Please download the update first.');
    }

    try {
      logger.info('🚀 Installing update and restarting...');
      autoUpdater.quitAndInstall(false, true);
      // This point is rarely reached as the app exits immediately
      return { success: true, message: 'Update installed. Application will restart.' };
    } catch (error) {
      logger.error(`❌ Failed to install update: ${error.message}`);
      throw new Error(`Install failed: ${error.message}`);
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
      currentVersion: require('../../../package.json').version
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

    // Check immediately if it's been longer than the interval since last check
    const lastCheckTime = updateSettings.lastCheckTime 
      ? new Date(updateSettings.lastCheckTime).getTime() 
      : 0;
    const timeSinceLastCheck = Date.now() - lastCheckTime;
    
    if (timeSinceLastCheck >= intervalMs) {
      logger.info('⏰ Last check was too long ago, checking now...');
      setTimeout(() => {
        this.checkForUpdates().catch(err => {
          logger.error(`Failed to check for updates: ${err.message}`);
        });
      }, 5000); // Wait 5 seconds after app start
    }

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
}

module.exports = UpdateService;
