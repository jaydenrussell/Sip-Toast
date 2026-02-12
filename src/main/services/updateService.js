const { autoUpdater } = require('electron-updater');
const { logger } = require('./logger');
const settings = require('../settings');
const https = require('https');

class UpdateService {
  constructor() {
    this.updateCheckInterval = null;
    this.isChecking = false;
    this.updateAvailable = false;
    this.updateAvailableVersion = null;
    this.updateDownloaded = false;
    
    // Configure autoUpdater
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    
    this.githubConfig = {
      owner: 'jaydenrussell',
      repo: 'Sip-Toast',
      apiUrl: 'https://api.github.com',
      releasesUrl: 'https://github.com/jaydenrussell/Sip-Toast/releases'
    };
    
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
      logger.info(`📥 Download progress: ${Math.round(progressObj.percent)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      logger.info(`✅ Update downloaded: ${info.version}`);
      this.updateDownloaded = true;
      this.updateAvailable = false;
    });
  }

  getCurrentVersion() {
    try {
      return require('../../../package.json').version || 'Unknown';
    } catch {
      return 'Unknown';
    }
  }

  compareVersions(current, latest) {
    if (!current || !latest) return 0;
    const cleanCurrent = current.replace('v', '');
    const cleanLatest = latest.replace('v', '');
    const currentParts = cleanCurrent.split('.').map(Number);
    const latestParts = cleanLatest.split('.').map(Number);
    
    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
      const curr = currentParts[i] || 0;
      const lat = latestParts[i] || 0;
      if (curr < lat) return -1;
      if (curr > lat) return 1;
    }
    return 0;
  }

  async getLatestReleaseFromGitHub() {
    return new Promise((resolve, reject) => {
      const url = `${this.githubConfig.apiUrl}/repos/${this.githubConfig.owner}/${this.githubConfig.repo}/releases/latest`;
      const options = {
        headers: { 'User-Agent': 'SIP-Toast-Update-Service', 'Accept': 'application/vnd.github.v3+json' }
      };

      const request = https.request(url, options, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          if (response.statusCode === 200) {
            const release = JSON.parse(data);
            resolve({
              version: release.tag_name.replace('v', ''),
              name: release.name,
              body: release.body,
              publishedAt: release.published_at,
              htmlUrl: release.html_url,
              assets: release.assets || []
            });
          } else {
            reject(new Error(`GitHub API returned status ${response.statusCode}`));
          }
        });
      });

      request.on('error', error => reject(new Error(`GitHub API request failed: ${error.message}`)));
      request.setTimeout(10000, () => { request.destroy(); reject(new Error('GitHub API request timed out')); });
      request.end();
    });
  }

  async checkForUpdatesWithGitHub() {
    try {
      logger.info('🔍 Checking for updates via GitHub API...');
      const latestRelease = await this.getLatestReleaseFromGitHub();
      const currentVersion = this.getCurrentVersion();
      const comparison = this.compareVersions(currentVersion, latestRelease.version);
      
      if (comparison < 0) {
        this.updateAvailable = true;
        this.updateAvailableVersion = latestRelease.version;
        this.isChecking = false;
        return { 
          updateAvailable: true, 
          version: latestRelease.version, 
          message: `Update available: ${latestRelease.version}`,
          release: latestRelease
        };
      } else {
        this.updateAvailable = false;
        this.updateAvailableVersion = null;
        this.isChecking = false;
        return { updateAvailable: false, version: currentVersion, message: 'You are using the latest version.' };
      }
    } catch (error) {
      this.isChecking = false;
      return { updateAvailable: false, error: error.message, message: 'Failed to check for updates via GitHub API' };
    }
  }

  async checkForUpdates(force = false) {
    if (this.isChecking && !force) {
      return { checking: true };
    }

    this.isChecking = true;
    this.updateAvailable = false;
    this.updateDownloaded = false;
    
    // Update last check time
    const updateSettings = settings.get('updates', {});
    updateSettings.lastCheckTime = new Date().toISOString();
    settings.set('updates', updateSettings);
    
    try {
      const githubResult = await this.checkForUpdatesWithGitHub();
      
      if (githubResult.error && !githubResult.updateAvailable) {
        // Fall back to electron-updater
        try {
          const result = await autoUpdater.checkForUpdates();
          const updateAvailable = !!(result?.updateInfo);
          this.updateAvailable = updateAvailable;
          this.isChecking = false;
          return { checking: false, updateAvailable, version: result?.updateInfo?.version };
        } catch (updaterError) {
          this.isChecking = false;
          return { checking: false, updateAvailable: false, error: `Both GitHub API and electron-updater failed: ${updaterError.message}` };
        }
      }
      
      this.isChecking = false;
      return { checking: false, updateAvailable: githubResult.updateAvailable, version: githubResult.version, message: githubResult.message };
    } catch (error) {
      this.isChecking = false;
      return { checking: false, updateAvailable: false, error: error.message };
    }
  }

  async downloadUpdate() {
    // Allow download if updateAvailable is true OR if updateDownloaded is true (already downloaded)
    // Also check if we have a pending version from GitHub check
    if (!this.updateAvailable && !this.updateDownloaded && !this.updateAvailableVersion) {
      throw new Error('Please check for updates first to find an available update');
    }

    // Set the feed URL for GitHub provider
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: this.githubConfig.owner,
      repo: this.githubConfig.repo,
      releaseType: 'release'
    });
    
    logger.info('📥 Starting update download...');
    
    try {
      const result = await autoUpdater.downloadUpdate();
      this.updateDownloaded = true;
      this.updateAvailable = false;
      logger.info('✅ Update download initiated successfully');
      return { success: true, message: 'Update download started' };
    } catch (error) {
      logger.error(`❌ Update download failed: ${error.message}`);
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  async installUpdate() {
    if (!this.updateDownloaded) {
      throw new Error('No update has been downloaded yet. Please download the update first.');
    }
    logger.info('🚀 Installing update and restarting...');
    autoUpdater.quitAndInstall(false, true);
    return { success: true, message: 'Update installed. Application will restart.' };
  }

  getStatus() {
    return {
      checking: this.isChecking,
      updateAvailable: this.updateAvailable,
      updateDownloaded: this.updateDownloaded,
      currentVersion: this.getCurrentVersion(),
      version: this.updateAvailableVersion || this.getCurrentVersion()
    };
  }

  startAutoCheck() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
    }

    const updateSettings = settings.get('updates', {});
    
    if (!updateSettings.enabled || updateSettings.checkFrequency === 'never') {
      logger.info('⏸️ Auto-update is disabled');
      return;
    }

    const intervals = {
      daily: 24 * 60 * 60 * 1000,
      weekly: 7 * 24 * 60 * 60 * 1000,
      monthly: 30 * 24 * 60 * 60 * 1000
    };

    const intervalMs = intervals[updateSettings.checkFrequency] || intervals.daily;
    logger.info(`🔄 Auto-update check scheduled: ${updateSettings.checkFrequency}`);

    // Check immediately if it's been longer than the interval
    const lastCheckTime = updateSettings.lastCheckTime ? new Date(updateSettings.lastCheckTime).getTime() : 0;
    if (Date.now() - lastCheckTime >= intervalMs) {
      logger.info('⏰ Last check was too long ago, checking now...');
      setTimeout(() => {
        this.checkForUpdates().catch(err => logger.error(`Failed to check for updates: ${err.message}`));
      }, 5000);
    }

    this.updateCheckInterval = setInterval(() => {
      logger.info(`🔄 Periodic update check (${updateSettings.checkFrequency})`);
      this.checkForUpdates().catch(err => logger.error(`Failed to check for updates: ${err.message}`));
    }, intervalMs);
  }

  stopAutoCheck() {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval);
      this.updateCheckInterval = null;
      logger.info('⏸️ Auto-update checking stopped');
    }
  }

  restartAutoCheck() {
    this.stopAutoCheck();
    this.startAutoCheck();
  }
}

module.exports = UpdateService;
