/**
 * Update Service for background updates (Discord/Teams-style)
 * Allows updates to download and install without requiring app restart
 */

const { logger } = require('./logger');
const { logUpdateCheck, logUpdateAvailable, logUpdateDownloaded, logUpdateInstalled, logUpdateError } = require('./eventLogger');
const { EventEmitter } = require('events');
const { app, BrowserWindow, ipcMain } = require('electron');
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
      checking: false,
      downloading: false,
      available: false,
      downloaded: false,
      progress: 0,
      version: null,
      current: app?.getVersion() || '0.0.0',
      lastCheck: null,
      error: null,
      downloadSpeed: null,
      installing: false
    };
    this._checked = false;
    this._updateProcess = null;
    this._updateWindow = null;

    // Set up IPC handlers
    this._setupIpcHandlers();
  }

_setupIpcHandlers() {
ipcMain.handle('update:check', async () => {
  return await this.checkForUpdates();
});

ipcMain.handle('update:install', async () => {
      await this.installUpdate();
      return this.getStatus();
    });

    ipcMain.handle('update:manual', async () => {
      return await this.downloadUpdateInBackground();
    });

    ipcMain.handle('update:status', () => {
      return this.getStatus();
    });
  }

  getStatus() {
    return {
      checking: this.state.checking,
      downloading: this.state.downloading,
      updateAvailable: this.state.available,
      updateDownloaded: this.state.downloaded,
      downloadProgress: this.state.progress,
      downloadSpeed: this.state.downloadSpeed,
      currentVersion: this.state.current,
      availableVersion: this.state.version,
      lastCheck: this.state.lastCheck,
      error: this.state.error,
      installing: this.state.installing
    };
  }

  emitStatus() {
    this.emit('update-status', this.getStatus());
  }

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
    const installDir = path.dirname(path.dirname(path.dirname(app.getAppPath())));
    const packagesDir = path.join(installDir, 'packages');
    if (!fs.existsSync(packagesDir)) return;

    for (const file of fs.readdirSync(packagesDir)) {
      if (file !== 'RELEASES' && !file.includes(this.state.current) && file.endsWith('.nupkg')) {
        try { fs.unlinkSync(path.join(packagesDir, file)); logger.info(`Cleaned: ${file}`); } catch {}
      }
    }
  }

async checkForUpdates() {
    if (this.state.checking || this.state.downloading) return this.getStatus();
    if (!app.isPackaged) {
      logger.info('Skipping update check (dev)');
      return this.getStatus();
    }

    this.state.error = null;
    this.state.checking = true;
    this.emitStatus();

    try {
      logUpdateCheck('manual');
      const release = await this._fetch(`https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}/releases/latest`);
      this.state.checking = false;
      this.state.lastCheck = new Date();

      if (!release?.tag_name) {
        this.emitStatus();
        return this.getStatus();
      }

      const version = release.tag_name.replace(/^v/, '');
      if (!this._newer(version, this.state.current)) {
        logger.info('Already up to date');
        this.emitStatus();
        return this.getStatus();
      }

      logUpdateAvailable(version, `https://github.com/${GITHUB.owner}/${GITHUB.repo}/releases/download/${release.tag_name}/`);
      logger.info(`Update available: v${version}`);

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
        logUpdateDownloaded(version);
        logger.info(`Update v${version} ready`);
      }
      this.emitStatus();
    } catch (error) {
      logUpdateError(error.message, 'download');
      logger.error(`Update check failed: ${error.message}`);
      this.state.checking = false;
      this.state.downloading = false;
      this.setError(error.message);
    }
    return this.getStatus();
  }

  async _downloadUpdate(tag) {
    const version = this.state.version;
    const installDir = path.dirname(path.dirname(path.dirname(app.getAppPath())));
    const packagesDir = path.join(installDir, 'packages');

    if (!fs.existsSync(packagesDir)) fs.mkdirSync(packagesDir, { recursive: true });
    this._cleanupOldPackages();

    const baseUrl = `https://github.com/${GITHUB.owner}/${GITHUB.repo}/releases/download/${tag}`;
    const releasesPath = path.join(packagesDir, 'RELEASES');

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
      const destPath = path.join(packagesDir, file.name);

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

    const fullPackage = path.join(packagesDir, `SIPCallerID-${version}-full.nupkg`);
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

  restartAutoCheck() {
    this._checked = false;
    this.startAutoCheck();
  }

async installUpdate() {
    if (!app.isPackaged) {
      logger.error('Cannot install update: Application is not packaged');
      this.setError('Update only available in packaged version');
      return;
    }

    if (!this.state.downloaded) {
      logger.error('No update downloaded - cannot install');
      this.setError('No update ready to install');
      return;
    }

    // Show update available notification
    if (this.state.available && !this.state.downloaded) {
      this.emit('update-available', this.state.version);
      return;
    }

    this.state.installing = true;
    this.emitStatus();

    try {
      const installDir = path.dirname(path.dirname(path.dirname(app.getAppPath())));
      const updateExe = path.join(installDir, 'Update.exe');
      const packagesDir = path.join(installDir, 'packages');

      // Verify Update.exe exists
      if (!fs.existsSync(updateExe)) {
        logger.error(`Update.exe not found at: ${updateExe}`);
        this.setError('Squirrel update executable not found');
        this.state.installing = false;
        this.emitStatus();
        return;
      }

      // Verify package exists
      const fullPackage = path.join(packagesDir, `SIPCallerID-${this.state.version}-full.nupkg`);
      if (!fs.existsSync(fullPackage)) {
        logger.error(`Full package not found: ${fullPackage}`);
        this.setError('Update package not found');
        this.state.installing = false;
        this.emitStatus();
        return;
      }

      logger.info(`Installing v${this.state.version}...`);

      // Spawn Update.exe in detached mode
      const updateProcess = spawn(updateExe, ['--update', packagesDir], {
        cwd: installDir,
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });

      updateProcess.unref();
      this._updateProcess = updateProcess;

      // Close all windows gracefully
      const windows = BrowserWindow.getAllWindows();
      for (const w of windows) {
        try {
          if (!w.isDestroyed()) {
            w.close();
          }
        } catch (e) {
          logger.error(`Error closing window: ${e.message}`);
        }
      }

      // Wait a moment for windows to close
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Exit the application
      app.quit();

      // Log successful installation
      logUpdateInstalled(this.state.version);
      this.state.installing = false;
      this.emitStatus();
    } catch (err) {
      logUpdateError(err.message, 'installation');
      logger.error(`Update installation failed: ${err.message}`);
      this.setError(`Installation failed: ${err.message}`);
      this.state.installing = false;
      this.emitStatus();
    }
  }

  // New method for background updates
async downloadUpdateInBackground() {
    if (this.state.downloading) return this.getStatus();

    this.state.downloading = true;
    this.state.progress = 0;
    this.emitStatus();

    // Show update available notification
    if (this.state.available && !this.state.downloaded) {
      this.emit('update-available', this.state.version);
    }

    try {
      const release = await this._fetch(`https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}/releases/latest`);
      const version = release.tag_name.replace(/^v/, '');

      if (!this._newer(version, this.state.current)) {
        this.state.downloading = false;
        this.emitStatus();
        return this.getStatus();
      }

      this.state.version = version;
      this.state.available = true;

      const success = await this._downloadUpdate(release.tag_name);
      this.state.downloaded = success;
      this.state.progress = success ? 100 : 0;
      this.state.downloading = false;

      if (success) {
        logger.info(`Background update v${version} ready`);
        // Show notification to user
        this.emit('update-ready', version);
      }

      this.emitStatus();
      return this.getStatus();
    } catch (error) {
      logger.error(`Background update failed: ${error.message}`);
      this.setError(error.message);
      this.state.downloading = false;
      this.emitStatus();
      return this.getStatus();
    }
  }
}

module.exports = UpdateService;