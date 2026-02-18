const { logger } = require('./logger');
const { EventEmitter } = require('events');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Lazy load eventLogger to avoid circular dependencies
let _eventLogger = null;
const getEventLogger = () => {
  if (!_eventLogger) {
    try {
      _eventLogger = require('./eventLogger');
    } catch (e) {
      // Event logger not ready yet
    }
  }
  return _eventLogger;
};

const GITHUB_OWNER = 'jaydenrussell';
const GITHUB_REPO = 'Sip-Toast';
const RELEASES_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

/**
 * Squirrel.Windows Auto-Updater Service
 *
 * Uses Squirrel's Update.exe directly (the same way Discord/Slack/Teams do it).
 * This is the most reliable approach for Squirrel.Windows installs.
 *
 * Flow:
 * 1. Fetch latest release from GitHub API
 * 2. Compare version with current
 * 3. If newer, run: Update.exe --update <releases-url>
 * 4. Squirrel downloads and stages the update
 * 5. On next launch, Squirrel applies the update automatically
 */
class UpdateService extends EventEmitter {
  constructor() {
    super();

    this.isChecking = false;
    this.isDownloading = false;
    this.updateAvailable = false;
    this.downloadProgress = 0;
    this.availableVersion = null;
    this.currentVersion = null;
    this.updateDownloaded = false;
    this.hasCheckedOnStartup = false;
    this.lastCheckTime = null;
    this._checkTrigger = null;
    this._autoCheckInterval = null;

    try {
      this.currentVersion = app.getVersion();
    } catch (e) {
      this.currentVersion = 'Unknown';
    }

    logger.info(`📦 UpdateService initialized - current version: v${this.currentVersion}`);
    logger.info(`📦 App packaged: ${app.isPackaged}`);
    logger.info(`📦 Update.exe path: ${this._getUpdateExePath() || 'not found (dev mode)'}`);
  }

  /**
   * Get the Squirrel Update.exe path
   */
  _getUpdateExePath() {
    if (!app.isPackaged) return null;

    const appFolder = path.dirname(app.getAppPath());
    const candidates = [
      path.join(appFolder, '..', 'Update.exe'),           // %LocalAppData%\SIPToast\Update.exe
      path.join(appFolder, 'Update.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'SIPToast', 'Update.exe'),
    ];

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          return p;
        }
      } catch (e) {
        // ignore
      }
    }
    return null;
  }

  /**
   * Get the GitHub releases URL for Squirrel (points to the release assets)
   */
  _getReleasesUrl(releaseTag) {
    return `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${releaseTag}`;
  }

  /**
   * Fetch latest release info from GitHub API
   */
  _fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': `SIPToast/${this.currentVersion}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 15000
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`GitHub API returned ${res.statusCode}: ${data}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse GitHub response: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('GitHub API request timed out'));
      });

      req.end();
    });
  }

  /**
   * Compare semver versions
   * Returns true if remoteVersion > localVersion
   */
  _isNewerVersion(remoteVersion, localVersion) {
    const parse = (v) => v.replace(/^v/, '').split('.').map(Number);
    const remote = parse(remoteVersion);
    const local = parse(localVersion);

    for (let i = 0; i < Math.max(remote.length, local.length); i++) {
      const r = remote[i] || 0;
      const l = local[i] || 0;
      if (r > l) return true;
      if (r < l) return false;
    }
    return false;
  }

  /**
   * Run Squirrel Update.exe to download and stage the update
   */
  _runSquirrelUpdate(releasesUrl) {
    return new Promise((resolve, reject) => {
      const updateExe = this._getUpdateExePath();
      if (!updateExe) {
        reject(new Error('Update.exe not found - app may not be installed via Squirrel'));
        return;
      }

      logger.info(`🔄 Running Squirrel update: ${updateExe} --update ${releasesUrl}`);

      const { spawn } = require('child_process');
      const proc = spawn(updateExe, ['--update', releasesUrl], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });

      proc.on('error', (err) => {
        logger.error(`❌ Squirrel Update.exe error: ${err.message}`);
        reject(err);
      });

      // Squirrel runs in background - we don't wait for it to finish
      // It will stage the update and the next launch will apply it
      proc.unref();

      // Poll for completion by checking for new app version folder
      let pollCount = 0;
      const maxPolls = 120; // 2 minutes max
      const pollInterval = setInterval(() => {
        pollCount++;
        const progress = Math.min(Math.round((pollCount / maxPolls) * 100), 95);
        this.downloadProgress = progress;
        this.emitStatus();

        // Check if Squirrel has staged the update (new version folder appears)
        const appFolder = path.dirname(app.getAppPath());
        const parentFolder = path.dirname(appFolder);

        try {
          const entries = fs.readdirSync(parentFolder);
          const newVersionFolder = entries.find(e => {
            if (!e.startsWith('app-')) return false;
            const ver = e.replace('app-', '');
            return this.availableVersion && this._isNewerVersion(ver, this.currentVersion);
          });

          if (newVersionFolder) {
            clearInterval(pollInterval);
            logger.info(`✅ Squirrel staged update in: ${newVersionFolder}`);
            resolve();
          }
        } catch (e) {
          // ignore read errors
        }

        if (pollCount >= maxPolls) {
          clearInterval(pollInterval);
          // Resolve anyway - Squirrel may still be running
          logger.warn('⚠️ Squirrel update polling timed out - update may still be in progress');
          resolve();
        }
      }, 1000);
    });
  }

  /**
   * Emit current status to listeners
   */
  emitStatus() {
    this.emit('update-status', this.getStatus());
  }

  /**
   * Check for updates against GitHub releases
   * @param {string} trigger - 'manual', 'auto', or 'app_load'
   */
  async checkForUpdates(trigger = 'manual') {
    if (this.isChecking || this.isDownloading) {
      logger.info('⏸️ Update check already in progress');
      return this.getStatus();
    }

    if (!app.isPackaged) {
      logger.info('⚠️ Skipping update check in development mode (app not packaged)');
      return this.getStatus();
    }

    const updateExe = this._getUpdateExePath();
    if (!updateExe) {
      logger.warn('⚠️ Update.exe not found - cannot update (not a Squirrel install)');
      return this.getStatus();
    }

    this.isChecking = true;
    this._checkTrigger = trigger;
    this.emitStatus();

    // Log to event logger
    const evtLogger = getEventLogger();
    if (evtLogger) {
      evtLogger.logUpdateCheck(trigger);
    }

    logger.info(`🔍 Checking GitHub for updates... (current: v${this.currentVersion}, trigger: ${trigger})`);
    logger.info(`   GitHub: https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`);

    try {
      const release = await this._fetchLatestRelease();
      const remoteVersion = release.tag_name.replace(/^v/, '');
      const releaseTag = release.tag_name;

      logger.info(`📦 Latest GitHub release: ${releaseTag} (current: v${this.currentVersion})`);

      this.isChecking = false;
      this.lastCheckTime = new Date();

      if (this._isNewerVersion(remoteVersion, this.currentVersion)) {
        logger.info(`📥 Update available: v${remoteVersion} (current: v${this.currentVersion})`);
        this.availableVersion = remoteVersion;
        this.updateAvailable = true;
        this.isDownloading = true;
        this.downloadProgress = 0;

        // Log to event logger
        if (evtLogger) {
          evtLogger.logUpdateAvailable(remoteVersion, release.published_at);
        }

        this.emitStatus();

        // Run Squirrel update in background
        const releasesUrl = this._getReleasesUrl(releaseTag);
        logger.info(`🔄 Starting Squirrel update from: ${releasesUrl}`);

        try {
          await this._runSquirrelUpdate(releasesUrl);

          this.updateDownloaded = true;
          this.isDownloading = false;
          this.downloadProgress = 100;

          // Log to event logger
          if (evtLogger) {
            evtLogger.logUpdateDownloaded(remoteVersion);
          }

          logger.info(`✅ Update v${remoteVersion} staged - will apply on next restart`);
          this.emitStatus();
        } catch (downloadError) {
          logger.error(`❌ Failed to download update: ${downloadError.message}`);
          this.isDownloading = false;
          this.updateAvailable = false;

          if (evtLogger) {
            evtLogger.logUpdateError(downloadError.message, 'downloading');
          }

          this.emitStatus();
        }
      } else {
        logger.info(`✅ App is up to date (v${this.currentVersion} is current)`);
        this.updateAvailable = false;
        this.emitStatus();
      }

      return this.getStatus();
    } catch (error) {
      logger.error(`❌ Update check failed: ${error.message}`);
      this.isChecking = false;
      this.isDownloading = false;

      if (evtLogger) {
        evtLogger.logUpdateError(error.message, 'checking');
      }

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
   * Start automatic update checking
   */
  startAutoCheck() {
    if (this.hasCheckedOnStartup) return;

    setTimeout(() => {
      if (!this.hasCheckedOnStartup) {
        this.hasCheckedOnStartup = true;
        logger.info('🔄 Checking for updates at startup...');
        this.checkForUpdates('app_load');
      }
    }, 30000); // 30 second delay

    logger.info('📅 Auto-update check scheduled (30s delay at startup)');
  }

  /**
   * Restart auto-check (called when update settings change)
   */
  restartAutoCheck() {
    if (this._autoCheckInterval) {
      clearInterval(this._autoCheckInterval);
      this._autoCheckInterval = null;
    }
    this.hasCheckedOnStartup = false;
    this.startAutoCheck();
  }

  /**
   * Quit and install update - restarts the app via Squirrel
   */
  quitAndInstall() {
    if (!this.updateDownloaded) {
      logger.warn('No update staged to install');
      return;
    }

    logger.info('🔄 Restarting app to apply update...');

    // Log to event logger before installing
    const evtLogger = getEventLogger();
    if (evtLogger) {
      evtLogger.logUpdateInstalled(this.availableVersion);
    }

    // Squirrel applies the staged update on next launch
    // Simply restart the app - Squirrel will handle the rest
    app.relaunch();
    app.exit(0);
  }
}

module.exports = UpdateService;