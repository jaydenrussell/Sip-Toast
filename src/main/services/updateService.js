const { logger } = require('./logger');
const { EventEmitter } = require('events');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn, execFile } = require('child_process');
const { URL } = require('url');

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
   * Fast download with progress tracking using native Node.js
   * Downloads directly to the Squirrel packages folder
   */
  _downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      
      // High-performance options
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': `SIPToast/${this.currentVersion}`,
          'Accept-Encoding': 'identity', // Disable compression for faster downloads
          'Connection': 'keep-alive'
        },
        timeout: 30000 // 30 second timeout
      };

      logger.info(`📥 Downloading: ${url}`);
      
      const request = protocol.request(options, (response) => {
        // Handle redirects (GitHub uses 302)
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            logger.info(`↪️ Redirect to: ${redirectUrl}`);
            response.destroy();
            return this._downloadFile(redirectUrl, destPath, onProgress).then(resolve).catch(reject);
          }
        }
        
        if (response.statusCode !== 200) {
          response.destroy();
          return reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        }
        
        const totalSize = parseInt(response.headers['content-length'], 10) || 0;
        let downloadedSize = 0;
        let lastProgressTime = Date.now();
        
        logger.info(`   File size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        
        // Create write stream
        const fileStream = fs.createWriteStream(destPath);
        
        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          
          // Report progress at most every 100ms
          const now = Date.now();
          if (now - lastProgressTime >= 100 || downloadedSize === totalSize) {
            lastProgressTime = now;
            if (onProgress && totalSize > 0) {
              const progress = Math.round((downloadedSize / totalSize) * 100);
              onProgress(progress, downloadedSize, totalSize);
            }
          }
        });
        
        response.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close();
          logger.info(`✅ Download complete: ${path.basename(destPath)}`);
          resolve(destPath);
        });
        
        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {}); // Delete partial file
          reject(err);
        });
      });
      
      request.on('error', (err) => {
        logger.error(`❌ Download error: ${err.message}`);
        reject(err);
      });
      
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
      
      request.end();
    });
  }

  /**
   * Fast update download - downloads nupkg files directly, then applies with Squirrel
   * This is much faster than Squirrel's built-in downloader
   */
  async _fastDownloadUpdate(releaseTag) {
    const installFolder = this._getInstallFolder();
    const packagesDir = path.join(installFolder, 'packages');
    
    // Ensure packages directory exists
    if (!fs.existsSync(packagesDir)) {
      fs.mkdirSync(packagesDir, { recursive: true });
    }
    
    const baseUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${releaseTag}`;
    
    // Files to download
    const files = [
      { name: 'RELEASES', url: `${baseUrl}/RELEASES` },
      { name: `SIPToast-${this.availableVersion}-full.nupkg`, url: `${baseUrl}/SIPToast-${this.availableVersion}-full.nupkg` }
    ];
    
    // Also try to download delta if available (smaller)
    const deltaFile = { name: `SIPToast-${this.availableVersion}-delta.nupkg`, url: `${baseUrl}/SIPToast-${this.availableVersion}-delta.nupkg` };
    
    logger.info(`🚀 Fast downloading update files...`);
    
    let totalSize = 0;
    let downloadedSize = 0;
    let currentFileIndex = 0;
    
    // Download RELEASES file first to check for delta
    try {
      const releasesPath = path.join(packagesDir, 'RELEASES');
      await this._downloadFile(files[0].url, releasesPath, (progress, downloaded, total) => {
        // Small file, just show we're working
        this.downloadProgress = 1;
        this.emitStatus();
      });
      
      // Check if delta is available in RELEASES
      const releasesContent = fs.readFileSync(releasesPath, 'utf8');
      if (releasesContent.includes(`SIPToast-${this.availableVersion}-delta.nupkg`)) {
        files.push(deltaFile);
        logger.info(`   Delta package available, will download smaller delta`);
      }
    } catch (e) {
      logger.warn(`   Could not download RELEASES: ${e.message}`);
    }
    
    // Calculate total files to download (skip RELEASES as it's done)
    const nupkgFiles = files.slice(1);
    
    // Download nupkg files
    for (let i = 0; i < nupkgFiles.length; i++) {
      const file = nupkgFiles[i];
      const destPath = path.join(packagesDir, file.name);
      
      // Skip if already downloaded
      if (fs.existsSync(destPath)) {
        const stats = fs.statSync(destPath);
        if (stats.size > 1000000) { // At least 1MB
          logger.info(`   ⏭️ Already exists: ${file.name}`);
          continue;
        }
      }
      
      currentFileIndex = i;
      
      await this._downloadFile(file.url, destPath, (progress, fileDownloaded, fileTotal) => {
        // Calculate overall progress (nupkg files are the bulk of the download)
        const fileWeight = 1 / nupkgFiles.length;
        const baseProgress = (currentFileIndex / nupkgFiles.length) * 100;
        const fileProgress = progress * fileWeight;
        this.downloadProgress = Math.min(Math.round(baseProgress + fileProgress), 99);
        this.emitStatus();
      });
    }
    
    this.downloadProgress = 100;
    this.emitStatus();
    
    logger.info(`✅ All update files downloaded to: ${packagesDir}`);
    return packagesDir;
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

        logger.info(`🔄 Starting fast update download for v${remoteVersion}...`);

        try {
          // Use fast custom downloader instead of Squirrel's slow one
          await this._fastDownloadUpdate(releaseTag);
          
          // Now run Squirrel to apply the update (it will use the already-downloaded files)
          const updateExe = this._getUpdateExePath();
          const installFolder = this._getInstallFolder();
          
          logger.info(`🔄 Applying update with Squirrel...`);
          
          // Run Squirrel to apply the downloaded packages
          await new Promise((resolve, reject) => {
            const proc = spawn(updateExe, ['--update', this._getReleasesUrl(releaseTag)], {
              stdio: ['ignore', 'pipe', 'pipe'],
              cwd: installFolder,
              windowsHide: true
            });
            
            let stdout = '';
            let stderr = '';
            
            proc.stdout?.on('data', (data) => { stdout += data.toString(); });
            proc.stderr?.on('data', (data) => { stderr += data.toString(); });
            
            proc.on('error', reject);
            proc.on('close', (code) => {
              if (code === 0 || fs.existsSync(path.join(installFolder, `app-${remoteVersion}`))) {
                resolve();
              } else {
                reject(new Error(`Squirrel apply failed: ${code}. ${stderr}`));
              }
            });
          });

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
   * Kill all other instances of the app (by process name, excluding current PID)
   * Returns a promise that resolves when all instances are terminated
   */
  async _killOtherInstances() {
    const exeName = path.basename(process.execPath);
    const currentPid = process.pid;
    
    logger.info(`🔪 Killing other instances of ${exeName} (current PID: ${currentPid})...`);
    
    return new Promise((resolve) => {
      // Use PowerShell to find and kill other instances by PID
      // This is more reliable than taskkill for excluding current process
      const psScript = `
        $currentPid = ${currentPid}
        $exeName = "${exeName}"
        Get-Process -Name $exeName.Replace('.exe','') -ErrorAction SilentlyContinue | 
          Where-Object { $_.Id -ne $currentPid } | 
          ForEach-Object { 
            Write-Host "Killing PID $($_.Id)"
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue 
          }
      `;
      
      const proc = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout?.on('data', (data) => {
        stdout += data.toString();
        logger.info(`   ${data.toString().trim()}`);
      });
      
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      proc.on('close', (code) => {
        logger.info(`   PowerShell exited with code: ${code}`);
        if (stderr) logger.info(`   stderr: ${stderr.trim()}`);
        
        // Give processes a moment to fully terminate
        setTimeout(resolve, 1500);
      });
      
      proc.on('error', (err) => {
        logger.warn(`   PowerShell error: ${err.message}`);
        // Fallback: try taskkill anyway (will kill current too, but update should still work)
        logger.info('   Falling back to taskkill...');
        const fallback = spawn('taskkill', ['/F', '/IM', exeName], {
          stdio: 'ignore',
          windowsHide: true
        });
        fallback.on('close', () => setTimeout(resolve, 1500));
        fallback.on('error', () => resolve());
      });
    });
  }

  /**
   * Quit and install update using Squirrel's mechanism.
   * 
   * The approach:
   * 1. Kill all other instances of the app
   * 2. Hide all windows
   * 3. Run Update.exe --processStartAndWait to apply update and start new version
   * 4. Force exit this process
   */
  async quitAndInstall() {
    if (!this.updateDownloaded) {
      logger.warn('No update staged to install');
      return;
    }

    const updateExe = this._getUpdateExePath();
    if (!updateExe) {
      logger.error('❌ Cannot install: Update.exe not found');
      return;
    }

    logger.info(`🔄 Installing update v${this.availableVersion}...`);

    // Log to event logger before installing
    const evtLogger = getEventLogger();
    if (evtLogger) {
      evtLogger.logUpdateInstalled(this.availableVersion);
    }

    const installFolder = this._getInstallFolder();
    const exeName = path.basename(process.execPath);

    logger.info(`   Update.exe: ${updateExe}`);
    logger.info(`   Install folder: ${installFolder}`);
    logger.info(`   Exe name: ${exeName}`);
    logger.info(`   Current PID: ${process.pid}`);

    // Step 1: Kill all other instances first
    await this._killOtherInstances();

    // Step 2: Hide all windows
    const { BrowserWindow } = require('electron');
    BrowserWindow.getAllWindows().forEach(win => {
      if (!win.isDestroyed()) {
        win.hide();
        win.destroy();
      }
    });

    // Step 3: Run Squirrel to apply update and start new version
    logger.info('🔄 Running Squirrel --processStartAndWait...');
    
    const proc = spawn(updateExe, ['--processStartAndWait', exeName], {
      detached: true, // Detach so Squirrel can start new instance
      stdio: ['ignore', 'ignore', 'ignore'],
      cwd: installFolder,
      windowsHide: false
    });

    proc.unref();

    proc.on('error', (err) => {
      logger.error(`❌ Failed to start Squirrel: ${err.message}`);
    });

    // Step 4: Force exit this process immediately
    // Squirrel will start the new version
    logger.info('🚪 Force exiting to allow update...');
    
    // Use setImmediate to ensure the spawn has started
    setImmediate(() => {
      // Force kill this process - don't give it a chance to interfere
      process.exit(0);
    });
  }
}

module.exports = UpdateService;
