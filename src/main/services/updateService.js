const { logger } = require('./logger');
const { EventEmitter } = require('events');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn, execFile } = require('child_process');

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

/**
 * Squirrel.Windows Auto-Updater Service
 *
 * Uses Squirrel's Update.exe directly (the same way Discord/Slack/Teams do it).
 *
 * Flow:
 * 1. Fetch latest release from GitHub API
 * 2. Compare version with current
 * 3. If newer, run: Update.exe --update <releases-url>
 * 4. Squirrel downloads and stages the update
 * 5. User clicks "Install" → Update.exe --processStart <exe> applies the update and restarts
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
    this._squirrelProc = null;

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
   * Squirrel installs to %LocalAppData%\<AppName>\Update.exe
   */
  _getUpdateExePath() {
    if (!app.isPackaged) return null;

    // app.getAppPath() returns something like:
    // C:\Users\User\AppData\Local\SIPToast\app-0.72.34\resources\app.asar
    const appPath = app.getAppPath();
    const appFolder = path.dirname(appPath);           // resources/
    const versionFolder = path.dirname(appFolder);     // app-0.72.34/
    const installFolder = path.dirname(versionFolder); // SIPToast/  ← Update.exe lives here

    const candidates = [
      path.join(installFolder, 'Update.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'SIPToast', 'Update.exe'),
      path.join(path.dirname(process.execPath), '..', 'Update.exe'),
    ];

    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          logger.info(`✅ Found Update.exe at: ${p}`);
          return p;
        }
      } catch (e) {
        // ignore
      }
    }

    logger.warn(`⚠️ Update.exe not found. Checked: ${candidates.join(', ')}`);
    return null;
  }

  /**
   * Get the install folder (parent of app-x.y.z)
   */
  _getInstallFolder() {
    const appPath = app.getAppPath();
    const appFolder = path.dirname(appPath);
    const versionFolder = path.dirname(appFolder);
    return path.dirname(versionFolder);
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
   * Run Squirrel Update.exe --update to download and stage the update.
   * Squirrel handles the download internally. We wait for it to finish
   * by monitoring the process exit code.
   */
  _runSquirrelUpdate(releasesUrl) {
    return new Promise((resolve, reject) => {
      const updateExe = this._getUpdateExePath();
      if (!updateExe) {
        reject(new Error('Update.exe not found - app may not be installed via Squirrel'));
        return;
      }

      logger.info(`🔄 Running: "${updateExe}" --update "${releasesUrl}"`);

      // Run Update.exe and wait for it to complete
      // Do NOT detach - we need to know when it finishes
      const proc = spawn(updateExe, ['--update', releasesUrl], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });

      this._squirrelProc = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Simulate progress while Squirrel downloads
      let progressTimer = null;
      let fakeProgress = 0;
      progressTimer = setInterval(() => {
        // Slowly increment progress up to 90% while waiting
        if (fakeProgress < 90) {
          fakeProgress += Math.random() * 3;
          this.downloadProgress = Math.min(Math.round(fakeProgress), 90);
          this.emitStatus();
        }
      }, 1500);

      proc.on('error', (err) => {
        clearInterval(progressTimer);
        this._squirrelProc = null;
        logger.error(`❌ Squirrel Update.exe error: ${err.message}`);
        reject(err);
      });

      proc.on('close', (code) => {
        clearInterval(progressTimer);
        this._squirrelProc = null;

        if (stdout) logger.info(`Squirrel stdout: ${stdout.trim()}`);
        if (stderr) logger.warn(`Squirrel stderr: ${stderr.trim()}`);

        if (code === 0) {
          logger.info(`✅ Squirrel update completed successfully (exit code: ${code})`);
          resolve();
        } else {
          // Squirrel sometimes exits with non-zero even on success
          // Check if the new version folder was created
          const installFolder = this._getInstallFolder();
          try {
            const entries = fs.readdirSync(installFolder);
            const newVersionFolder = entries.find(e => {
              if (!e.startsWith('app-')) return false;
              const ver = e.replace('app-', '');
              return this.availableVersion && this._isNewerVersion(ver, this.currentVersion);
            });

            if (newVersionFolder) {
              logger.info(`✅ Squirrel staged update in: ${newVersionFolder} (exit code: ${code})`);
              resolve();
            } else {
              reject(new Error(`Squirrel exited with code ${code}. stdout: ${stdout} stderr: ${stderr}`));
            }
          } catch (e) {
            reject(new Error(`Squirrel exited with code ${code}. stdout: ${stdout} stderr: ${stderr}`));
          }
        }
      });
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

        if (evtLogger) {
          evtLogger.logUpdateAvailable(remoteVersion, release.published_at);
        }

        this.emitStatus();

        const releasesUrl = this._getReleasesUrl(releaseTag);
        logger.info(`🔄 Starting Squirrel update from: ${releasesUrl}`);

        try {
          await this._runSquirrelUpdate(releasesUrl);

          this.updateDownloaded = true;
          this.isDownloading = false;
          this.downloadProgress = 100;

          if (evtLogger) {
            evtLogger.logUpdateDownloaded(remoteVersion);
          }

          logger.info(`✅ Update v${remoteVersion} staged - ready to install`);
          this.emitStatus();

          // Auto-install for background checks (app_load / auto triggers)
          // For manual checks, show the "Install Update" button instead
          if (trigger === 'app_load' || trigger === 'auto') {
            logger.info(`🔄 Auto-installing update (trigger: ${trigger})...`);
            // Small delay to let the status emit reach the renderer
            setTimeout(() => {
              this.quitAndInstall();
            }, 2000);
          }
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
   * Quit and install update using Squirrel's --processStart mechanism.
   *
   * The correct Squirrel install flow is:
   * 1. Update.exe --update <url>  → stages the new version in app-X.Y.Z/
   * 2. Update.exe --processStart <exe> --process-start-args <args>
   *    → applies the staged update, then launches the new version
   *
   * We must NOT use app.relaunch() as that relaunches the OLD version.
   */
  quitAndInstall() {
    if (!this.updateDownloaded) {
      logger.warn('No update staged to install');
      return;
    }

    const updateExe = this._getUpdateExePath();
    if (!updateExe) {
      logger.error('❌ Cannot install: Update.exe not found');
      return;
    }

    logger.info(`🔄 Installing update v${this.availableVersion} via Squirrel --processStart...`);

    // Log to event logger before installing
    const evtLogger = getEventLogger();
    if (evtLogger) {
      evtLogger.logUpdateInstalled(this.availableVersion);
    }

    // Get the executable name (e.g. SIPToast.exe)
    // process.execPath is the full path to the running exe
    const exeName = path.basename(process.execPath);
    const installFolder = this._getInstallFolder();

    logger.info(`   Update.exe: ${updateExe}`);
    logger.info(`   Install folder: ${installFolder}`);
    logger.info(`   Exe name: ${exeName}`);

    // Squirrel --processStart flow:
    // Update.exe --processStart <exeName>
    // Squirrel will:
    //   1. Move the staged app-X.Y.Z into place
    //   2. Launch the new version of <exeName> from the install folder
    // We then exit the old process.
    //
    // Note: exeName must be just the filename, not a full path.
    // Squirrel looks for it relative to the install folder.
    
    // First, hide all windows to indicate update is in progress
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.hide();
      }
    });
    
    // Use Squirrel's built-in update mechanism
    // The --processStart command will:
    // 1. Apply the update (move new version into place)
    // 2. Start the new version
    // 3. We exit the old version
    const proc = spawn(updateExe, ['--processStart', exeName], {
      detached: true,
      stdio: 'ignore',
      cwd: installFolder,
      windowsHide: false
    });

    proc.on('error', (err) => {
      logger.error(`❌ Failed to start Squirrel update: ${err.message}`);
    });

    proc.unref();

    // Wait longer for Squirrel to complete the update and start the new version
    // Squirrel needs time to:
    // 1. Stop the current app processes
    // 2. Move files into place
    // 3. Start the new version
    logger.info('🔄 Waiting for Squirrel to apply update and start new version...');
    
    // Give Squirrel more time before exiting
    setTimeout(() => {
      logger.info('🚪 Exiting old version - new version should be starting...');
      // Force exit - don't use app.quit() as it may trigger before-quit handlers
      process.exit(0);
    }, 3000);
  }
}

module.exports = UpdateService;
