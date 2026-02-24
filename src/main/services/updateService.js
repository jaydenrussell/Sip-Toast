/**
 * Update Service for Squirrel.Windows auto-updates
 */

const { logger } = require('./logger');
const { EventEmitter } = require('events');
const { app, BrowserWindow } = require('electron');

// Lazy-load eventLogger to avoid circular dependencies
let _eventLogger = null;
const getEventLogger = () => {
  if (!_eventLogger) {
    _eventLogger = require('./eventLogger');
  }
  return _eventLogger;
};
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');

const GITHUB = { owner: 'jaydenrussell', repo: 'Sip-Toast' };

class UpdateService extends EventEmitter {
  constructor() {
    super();
    this.state = {
      checking: false, downloading: false, available: false, downloaded: false,
      progress: 0, version: null, current: app?.getVersion() || '0.0.0',
      lastCheck: null, error: null, downloadSpeed: null
    };
    this._checked = false;
    if (app?.isPackaged) {
      this._installDir = path.dirname(path.dirname(path.dirname(app.getAppPath())));
      this._updateExe = path.join(this._installDir, 'Update.exe');
      this._packagesDir = path.join(this._installDir, 'packages');
    }
  }

  getStatus() {
    return {
      // Core status
      checking: this.state.checking,
      downloading: this.state.downloading,
      updateAvailable: this.state.available,
      updateDownloaded: this.state.downloaded,
      downloadProgress: this.state.progress,
      downloadSpeed: this.state.downloadSpeed,
      
      // Version info
      currentVersion: this.state.current,
      availableVersion: this.state.version,
      
      // Additional info
      lastCheck: this.state.lastCheck,
      error: this.state.error
    };
  }

  emitStatus() { this.emit('update-status', this.getStatus()); }

  setError(message) {
    this.state.error = message;
    logger.error(`Update error: ${message}`);
    this.emitStatus();
  }

  _newer(remote, local) {
    const r = remote.replace(/^v/, '').split('.').map(Number);
    const l = local.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((r[i] || 0) > (l[i] || 0)) return true;
      if ((r[i] || 0) < (l[i] || 0)) return false;
    }
    return false;
  }

  async _fetch(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const req = https.request(url, {
            headers: { 'User-Agent': 'SIPCallerID', 'Accept': 'application/vnd.github.v3+json' },
            timeout: 15000
          }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              if (res.statusCode === 200) try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
              else reject(new Error(res.statusCode === 403 ? 'Rate limited' : `HTTP ${res.statusCode}`));
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
          req.end();
        });
      } catch (error) {
        if (attempt === retries) throw error;
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }
  }

  async _download(url, dest, onProgress, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const urlObj = new URL(url);
          const httpModule = urlObj.protocol === 'http:' ? http : https;
          
          const req = httpModule.request({
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            headers: { 'User-Agent': 'SIPCallerID', 'Accept': '*/*' }
          }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return this._download(res.headers.location, dest, onProgress, retries).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            
            const total = parseInt(res.headers['content-length'], 10) || 0;
            let done = 0, lastEmit = 0, startTime = Date.now();
            const dir = path.dirname(dest);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const tempPath = dest + '.tmp';
            const file = fs.createWriteStream(tempPath);
            
            res.on('data', chunk => {
              done += chunk.length;
              // Emit progress every 200ms or on first chunk for immediate feedback
              if (Date.now() - lastEmit > 200 || done === chunk.length) {
                lastEmit = Date.now();
                if (total > 0) {
                  this.state.downloadSpeed = this._formatSpeed(done / ((Date.now() - startTime) / 1000));
                  onProgress?.(Math.round(done / total * 100));
                }
              }
            });
            
            res.pipe(file);
            file.on('finish', () => {
              file.close();
              const stats = fs.statSync(tempPath);
              if (total > 0 && stats.size !== total) {
                fs.unlinkSync(tempPath);
                return reject(new Error(`Incomplete: ${stats.size}/${total}`));
              }
              try { if (fs.existsSync(dest)) fs.unlinkSync(dest); fs.renameSync(tempPath, dest); }
              catch { fs.copyFileSync(tempPath, dest); fs.unlinkSync(tempPath); }
              this.state.downloadSpeed = null;
              onProgress?.(100);
              resolve({ size: stats.size });
            });
            file.on('error', err => { fs.unlink(tempPath, () => {}); reject(err); });
          });
          
          req.on('error', reject);
          req.setTimeout(120000, () => { req.destroy(); reject(new Error('Timeout')); });
          req.end();
        });
      } catch (error) {
        if (attempt === retries) throw error;
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  _formatSpeed(bps) {
    return bps < 1024 ? `${bps.toFixed(0)} B/s` :
           bps < 1048576 ? `${(bps/1024).toFixed(1)} KB/s` :
           `${(bps/1048576).toFixed(1)} MB/s`;
  }

  _validFile(filePath) {
    try { return fs.existsSync(filePath) && fs.statSync(filePath).size >= 100; }
    catch { return false; }
  }

  _cleanupOldPackages() {
    if (!fs.existsSync(this._packagesDir)) return;
    for (const file of fs.readdirSync(this._packagesDir)) {
      if (file !== 'RELEASES' && !file.includes(this.state.current) && file.endsWith('.nupkg')) {
        try { fs.unlinkSync(path.join(this._packagesDir, file)); logger.info(`Cleaned: ${file}`); } catch {}
      }
    }
  }

  async checkForUpdates() {
    if (this.state.checking || this.state.downloading) return this.getStatus();
    if (!app.isPackaged || !fs.existsSync(this._updateExe)) {
      if (!app.isPackaged) logger.info('Skipping update check (dev)');
      else this.setError('Update system unavailable');
      return this.getStatus();
    }

    this.state.error = null;
    this.state.checking = true;
    this.emitStatus();
    
    // Log update check
    getEventLogger().logUpdateCheck(this._checked ? 'auto' : 'manual');

    try {
      const release = await this._fetch(`https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}/releases/latest`);
      this.state.checking = false;
      this.state.lastCheck = new Date();
      
      if (!release?.tag_name) { this.emitStatus(); return this.getStatus(); }

      const version = release.tag_name.replace(/^v/, '');
      if (!this._newer(version, this.state.current)) {
        logger.info('Already up to date');
        this.emitStatus();
        return this.getStatus();
      }

      logger.info(`Update available: v${version}`);
      
      // Log update available
      getEventLogger().logUpdateAvailable(version, release.html_url);
      
      this.state.available = true;
      this.state.version = version;
      this.state.downloading = true;
      this.state.progress = 0;
      this.emitStatus();

      const success = await this._downloadUpdate(release.tag_name);
      this.state.downloading = false;
      this.state.downloaded = success;
      this.state.progress = success ? 100 : 0;
      
      if (success) {
        logger.info(`Update v${version} ready`);
        // Log update downloaded
        getEventLogger().logUpdateDownloaded(version, this._packagesDir);
      }
      this.emitStatus();
    } catch (error) {
      logger.error(`Update check failed: ${error.message}`);
      this.state.checking = false;
      this.state.downloading = false;
      this.setError(error.message);
      // Log update error
      getEventLogger().logUpdateError(error.message, 'check');
    }
    return this.getStatus();
  }

  async _downloadUpdate(tag) {
    const version = this.state.version;
    if (!fs.existsSync(this._packagesDir)) fs.mkdirSync(this._packagesDir, { recursive: true });
    this._cleanupOldPackages();

    const baseUrl = `https://github.com/${GITHUB.owner}/${GITHUB.repo}/releases/download/${tag}`;
    const releasesPath = path.join(this._packagesDir, 'RELEASES');
    
    try {
      await this._download(`${baseUrl}/RELEASES`, releasesPath, p => {
        this.state.progress = Math.round(p * 0.02);
        this.emitStatus();
      });
    } catch (e) {
      this.setError(`Failed to download RELEASES: ${e.message}`);
      return false;
    }

    const hasDelta = fs.readFileSync(releasesPath, 'utf8').includes(`SIPCallerID-${version}-delta.nupkg`);
    const files = [
      { name: `SIPCallerID-${version}-full.nupkg`, required: true },
      hasDelta && { name: `SIPCallerID-${version}-delta.nupkg`, required: false }
    ].filter(Boolean);

    const weightPerFile = 98 / files.length;
    let currentProgress = 2;

    for (const file of files) {
      const destPath = path.join(this._packagesDir, file.name);
      
      if (this._validFile(destPath)) {
        logger.info(`Have: ${file.name}`);
        currentProgress += weightPerFile;
        this.state.progress = Math.round(currentProgress);
        this.emitStatus();
        continue;
      }

      try {
        await this._download(`${baseUrl}/${file.name}`, destPath, p => {
          this.state.progress = Math.round(currentProgress + (p * weightPerFile / 100));
          this.emitStatus();
        });
        if (this._validFile(destPath)) logger.info(`Got: ${file.name}`);
        else if (file.required) throw new Error('Invalid download');
      } catch (e) {
        logger.error(`Failed ${file.name}: ${e.message}`);
        if (file.required && (!fs.existsSync(destPath) || fs.statSync(destPath).size === 0)) {
          this.setError(`Failed: ${file.name}`);
          return false;
        }
      }
      currentProgress += weightPerFile;
      this.state.progress = Math.round(currentProgress);
      this.emitStatus();
    }

    const fullPackage = path.join(this._packagesDir, `SIPCallerID-${version}-full.nupkg`);
    if (!fs.existsSync(fullPackage) || fs.statSync(fullPackage).size === 0) {
      this.setError('Full package unavailable');
      return false;
    }
    return true;
  }

  startAutoCheck() {
    if (this._checked) return;
    this._checked = true;
    setTimeout(() => this.checkForUpdates(), 5000);
  }

  restartAutoCheck() { this._checked = false; this.startAutoCheck(); }

  async quitAndInstall() {
    if (!this.state.downloaded || !fs.existsSync(this._updateExe)) {
      this.setError('No update ready');
      return;
    }

    const fullPackage = path.join(this._packagesDir, `SIPCallerID-${this.state.version}-full.nupkg`);
    if (!fs.existsSync(fullPackage)) {
      this.setError('Package not found');
      this.state.downloaded = false;
      this.emitStatus();
      return;
    }

    logger.info(`Installing v${this.state.version}...`);
    this.emit('installing');
    getEventLogger().logUpdateInstalled(this.state.version);

    // Squirrel.Windows update process:
    // 1. Close all windows
    // 2. Run Update.exe with --update flag pointing to packages directory
    // 3. Exit the application
    // 4. Update.exe applies the update and restarts the app
    
    try {
      // Step 1: Close all windows gracefully
      logger.info('Closing all windows...');
      const windows = BrowserWindow.getAllWindows();
      for (const w of windows) {
        try {
          if (!w.isDestroyed()) {
            w.destroy(); // Force close to ensure clean exit
          }
        } catch (e) {
          logger.error(`Error closing window: ${e.message}`);
        }
      }
      
      // Step 2: Give windows time to close
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Step 3: Launch Update.exe to apply the update
      // The --update flag tells Squirrel to apply updates from the packages directory
      // Update.exe will:
      //   - Apply the .nupkg files
      //   - Update the app files
      //   - Restart the application
      const args = ['--update', this._packagesDir];
      
      logger.info(`Launching Update.exe: ${this._updateExe} ${args.join(' ')}`);
      logger.info(`Working directory: ${this._installDir}`);
      logger.info(`Packages directory: ${this._packagesDir}`);
      
      // Use spawn with detached:true and stdio:'ignore' for proper Squirrel behavior
      // This allows Update.exe to continue after our process exits
      const updateProcess = spawn(this._updateExe, args, {
        cwd: this._installDir,
        detached: true,
        stdio: 'ignore',  // Ignore stdio to properly detach
        windowsHide: true
      });
      
      // Detach the child process so it continues after we exit
      updateProcess.unref();
      
      logger.info('Update.exe launched successfully');
      logger.info('Exiting application to allow update installation...');
      
      // Step 4: Exit the application
      // Update.exe will restart the app after applying the update
      // Use app.quit() for graceful shutdown, then force exit after timeout
      const exitTimeout = setTimeout(() => {
        logger.info('Force exiting after timeout');
        process.exit(0);
      }, 3000);
      
      // Try graceful quit first
      app.quit();
      
    } catch (err) {
      logger.error(`Failed to launch Update.exe: ${err.message}`);
      logger.error(err.stack);
      
      // Fallback: Try using app.relaunch() and exit
      try {
        logger.info('Attempting fallback: relaunch and exit');
        app.relaunch();
        app.exit(0);
      } catch (fallbackErr) {
        logger.error(`Fallback failed: ${fallbackErr.message}`);
        // Last resort: force exit
        process.exit(0);
      }
    }
  }
}

module.exports = UpdateService;