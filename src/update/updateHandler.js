/**
 * Update Handler - Discord-style auto-update mechanism
 * This module handles update checking and download before main app launches
 */

const { app, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

class UpdateHandler {
  constructor() {
    this.updateInfo = null;
    this.githubConfig = {
      owner: 'jaydenrussell',
      repo: 'Sip-Toast',
      apiUrl: 'https://api.github.com',
      releasesUrl: 'https://github.com/jaydenrussell/Sip-Toast/releases'
    };
  }

  /**
   * Get current app version from package.json
   */
  getCurrentVersion() {
    try {
      const packagePath = path.join(__dirname, '..', '..', 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      return packageJson.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  /**
   * Compare semantic versions
   * Returns -1 if current < latest, 0 if equal, 1 if current > latest
   */
  compareVersions(current, latest) {
    const cleanCurrent = current.replace(/^v/, '').trim();
    const cleanLatest = latest.replace(/^v/, '').trim();

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

  /**
   * Fetch latest release info from GitHub API
   */
  getLatestRelease() {
    return new Promise((resolve, reject) => {
      const url = `${this.githubConfig.apiUrl}/repos/${this.githubConfig.owner}/${this.githubConfig.repo}/releases/latest`;
      
      const options = {
        headers: {
          'User-Agent': 'SIP-Toast-Update-Checker',
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 15000
      };

      const request = https.request(url, options, (response) => {
        let data = '';
        
        response.on('data', chunk => data += chunk);
        
        response.on('end', () => {
          if (response.statusCode === 200) {
            try {
              const release = JSON.parse(data);
              const latestVersion = release.tag_name.replace(/^v/, '');
              
              // Find the Windows installer asset
              const windowsAsset = (release.assets || []).find(asset => 
                asset.name && (
                  asset.name.endsWith('.exe') || 
                  asset.name.endsWith('.msi') ||
                  asset.name.toLowerCase().includes('windows')
                )
              );

              resolve({
                version: latestVersion,
                name: release.name || release.tag_name,
                body: release.body || '',
                publishedAt: release.published_at,
                htmlUrl: release.html_url,
                downloadUrl: windowsAsset?.browser_download_url || release.html_url + '/download',
                assetSize: windowsAsset?.size || 0,
                downloadCount: windowsAsset?.download_count || 0
              });
            } catch (parseError) {
              reject(new Error(`Failed to parse GitHub response: ${parseError.message}`));
            }
          } else if (response.statusCode === 404) {
            reject(new Error('Repository or release not found'));
          } else {
            reject(new Error(`GitHub API returned status ${response.statusCode}`));
          }
        });
      });

      request.on('error', error => {
        reject(new Error(`GitHub API request failed: ${error.message}`));
      });

      request.on('timeout', () => {
        request.destroy();
        reject(new Error('GitHub API request timed out'));
      });

      request.end();
    });
  }

  /**
   * Check for updates and return update info if available
   */
  async checkForUpdates() {
    try {
      const currentVersion = this.getCurrentVersion();
      const latestRelease = await this.getLatestRelease();
      
      const comparison = this.compareVersions(currentVersion, latestRelease.version);
      
      if (comparison < 0) {
        this.updateInfo = {
          available: true,
          currentVersion,
          latestVersion: latestRelease.version,
          name: latestRelease.name,
          body: latestRelease.body,
          publishedAt: latestRelease.publishedAt,
          htmlUrl: latestRelease.htmlUrl,
          downloadUrl: latestRelease.downloadUrl,
          assetSize: latestRelease.assetSize,
          downloadCount: latestRelease.downloadCount
        };
        
        return this.updateInfo;
      } else {
        this.updateInfo = null;
        return {
          available: false,
          currentVersion,
          latestVersion: currentVersion,
          message: 'You are using the latest version.'
        };
      }
    } catch (error) {
      return {
        available: false,
        error: error.message,
        message: 'Failed to check for updates'
      };
    }
  }

  /**
   * Download update using electron-updater's download flow
   * This integrates with the main app's update system
   */
  async downloadUpdate(autoUpdater, logger) {
    if (!this.updateInfo || !this.updateInfo.available) {
      throw new Error('No update available to download');
    }

    try {
      logger.info(`📥 Starting download for update ${this.updateInfo.latestVersion}`);
      
      // Set feed URL for GitHub provider
      autoUpdater.setFeedURL({
        provider: 'github',
        owner: this.githubConfig.owner,
        repo: this.githubConfig.repo,
        releaseType: 'release'
      });

      // Download the update
      const result = await autoUpdater.downloadUpdate();
      
      logger.info('✅ Update download initiated successfully');
      
      return {
        success: true,
        version: this.updateInfo.latestVersion,
        message: 'Update download started'
      };
    } catch (error) {
      logger.error(`❌ Update download failed: ${error.message}`);
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  /**
   * Install the downloaded update and restart the app
   */
  installUpdate(autoUpdater) {
    if (!this.updateInfo || !this.updateInfo.available) {
      throw new Error('No update available to install');
    }

    const logger = require('../services/logger');
    logger.info(`🚀 Installing update ${this.updateInfo.latestVersion} and restarting...`);
    
    // Quit and install the update
    autoUpdater.quitAndInstall(false, true);
    
    return {
      success: true,
      message: 'Update installed. Application will restart.'
    };
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get update info status
   */
  getStatus() {
    if (this.updateInfo && this.updateInfo.available) {
      return {
        checking: false,
        updateAvailable: true,
        updateDownloaded: false,
        currentVersion: this.updateInfo.currentVersion,
        latestVersion: this.updateInfo.latestVersion,
        releaseName: this.updateInfo.name,
        releaseNotes: this.updateInfo.body,
        publishedAt: this.updateInfo.publishedAt,
        htmlUrl: this.updateInfo.htmlUrl,
        downloadUrl: this.updateInfo.downloadUrl,
        assetSize: this.updateInfo.assetSize
      };
    }
    
    return {
      checking: false,
      updateAvailable: false,
      updateDownloaded: false,
      currentVersion: this.getCurrentVersion(),
      latestVersion: null
    };
  }
}

module.exports = UpdateHandler;
