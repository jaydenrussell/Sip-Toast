const { logger } = require('./logger');
const { EventEmitter } = require('events');
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
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
      current: app.getVersion() || '0.0.0',
      lastCheck: null
    };
    this._checked = false;
    this._installDir = null;
    this._updateExe = null;
    
    // Pre-compute paths
    if (app.isPackaged) {
      this._installDir = path.dirname(path.dirname(path.dirname(app.getAppPath())));
      this._updateExe = path.join(this._installDir, 'Update.exe');
    }
  }

  getStatus() {
    return {
      checking: this.state.checking,
      downloading: this.state.downloading,
      updateAvailable: this.state.available,
      updateDownloaded: this.state.downloaded,
      downloadProgress: this.state.progress,
      availableVersion: this.state.version,
      currentVersion: this.state.current,
      lastCheckTime: this.state.lastCheck
    };
  }

  emitStatus() {
    this.emit('update-status', this.getStatus());
  }

  async _fetch(url) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        headers: { 'User-Agent': 'SIPToast', 'Accept': 'application/vnd.github.v3+json' },
        timeout: 15000
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
      req.end();
    });
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

  async _download(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, { headers: { 'User-Agent': 'SIPToast' } }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._download(res.headers.location, dest, onProgress).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        
        const total = parseInt(res.headers['content-length'], 10) || 0;
        let done = 0;
        let lastEmit = 0;
        const file = fs.createWriteStream(dest);
        
        res.on('data', chunk => {
          done += chunk.length;
          const now = Date.now();
          if (now - lastEmit > 500 && total > 0) { // Emit every 500ms
            lastEmit = now;
            onProgress?.(Math.round(done / total * 100));
          }
        });
        
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          onProgress?.(100);
          resolve();
        });
        file.on('error', err => {
          fs.unlink(dest, () => {});
          reject(err);
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  async checkForUpdates(trigger = 'manual') {
    // Prevent duplicate checks
    if (this.state.checking || this.state.downloading) {
      logger.info('Update check already in progress');
      return this.getStatus();
    }
    
    // Skip in dev mode
    if (!app.isPackaged) {
      logger.info('Skipping update check (dev mode)');
      return this.getStatus();
    }
    
    // Check if Update.exe exists
    if (!fs.existsSync(this._updateExe)) {
      logger.warn('Update.exe not found');
      return this.getStatus();
    }

    logger.info(`Checking for updates... (current: v${this.state.current})`);
    this.state.checking = true;
    this.emitStatus();

    try {
      const release = await this._fetch(`https://api.github.com/repos/${GITHUB.owner}/${GITHUB.repo}/releases/latest`);
      
      this.state.checking = false;
      this.state.lastCheck = new Date();
      
      if (!release || !release.tag_name) {
        logger.warn('No release found');
        this.emitStatus();
        return this.getStatus();
      }

      const version = release.tag_name.replace(/^v/, '');
      logger.info(`Latest version: v${version}`);
      
      if (!this._newer(version, this.state.current)) {
        logger.info('Already up to date');
        this.emitStatus();
        return this.getStatus();
      }

      logger.info(`Update available: v${version}`);
      this.state.available = true;
      this.state.version = version;
      this.state.downloading = true;
      this.state.progress = 0;
      this.emitStatus();

      // Download in background
      await this._downloadUpdate(release.tag_name);
      
      this.state.downloading = false;
      this.state.downloaded = true;
      this.state.progress = 100;
      logger.info(`Update v${version} downloaded and ready`);
      this.emitStatus();

    } catch (error) {
      logger.error(`Update check failed: ${error.message}`);
      this.state.checking = false;
      this.state.downloading = false;
      this.emitStatus();
    }

    return this.getStatus();
  }

  async _downloadUpdate(tag) {
    const packagesDir = path.join(this._installDir, 'packages');
    
    // Create packages directory
    if (!fs.existsSync(packagesDir)) {
      fs.mkdirSync(packagesDir, { recursive: true });
    }

    const baseUrl = `https://github.com/${GITHUB.owner}/${GITHUB.repo}/releases/download/${tag}`;
    const version = this.state.version;
    
    // Download RELEASES file first
    const releasesPath = path.join(packagesDir, 'RELEASES');
    let hasDelta = false;
    
    try {
      logger.info('Downloading RELEASES...');
      await this._download(`${baseUrl}/RELEASES`, releasesPath, p => {
        this.state.progress = Math.round(p * 0.05); // 0-5%
        this.emitStatus();
      });
      
      // Check for delta package
      const releasesContent = fs.readFileSync(releasesPath, 'utf8');
      hasDelta = releasesContent.includes(`SIPToast-${version}-delta.nupkg`);
      if (hasDelta) {
        logger.info('Delta package available');
      }
    } catch (e) {
      logger.warn(`RELEASES download failed: ${e.message}`);
    }

    // Download nupkg files
    const files = [
      { name: `SIPToast-${version}-full.nupkg`, weight: hasDelta ? 0.3 : 0.95 }
    ];
    
    if (hasDelta) {
      files.push({ name: `SIPToast-${version}-delta.nupkg`, weight: 0.65 });
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const destPath = path.join(packagesDir, file.name);
      
      // Skip if already downloaded (at least 1MB)
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000000) {
        logger.info(`${file.name} already exists`);
        this.state.progress = Math.round((i + 1) / files.length * 100);
        this.emitStatus();
        continue;
      }

      logger.info(`Downloading ${file.name}...`);
      const startProgress = this.state.progress;
      
      try {
        await this._download(`${baseUrl}/${file.name}`, destPath, p => {
          this.state.progress = Math.round(startProgress + (p * file.weight));
          this.emitStatus();
        });
        logger.info(`${file.name} downloaded`);
      } catch (e) {
        logger.error(`Failed to download ${file.name}: ${e.message}`);
      }
    }

    this.state.progress = 100;
    this.emitStatus();
  }

  startAutoCheck() {
    if (this._checked) return;
    this._checked = true;
    
    logger.info('Scheduling automatic update check...');
    
    // Check after 3 seconds (let app fully initialize)
    setTimeout(() => {
      logger.info('Running automatic update check...');
      this.checkForUpdates('auto');
    }, 3000);
  }

  restartAutoCheck() {
    this._checked = false;
    this.startAutoCheck();
  }

  async quitAndInstall() {
    if (!this.state.downloaded) {
      logger.warn('No update ready to install');
      return;
    }
    
    if (!fs.existsSync(this._updateExe)) {
      logger.error('Update.exe not found');
      return;
    }

    logger.info(`Installing update v${this.state.version}...`);
    
    // Emit installing event so main.js can set isAppQuitting flag
    this.emit('installing');

    // Show install window
    const win = new BrowserWindow({
      width: 320,
      height: 140,
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: false,
      backgroundColor: '#1e293b',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    win.loadURL(`data:text/html,${encodeURIComponent(`
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            color: white;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
          }
          .spinner {
            width: 28px;
            height: 28px;
            border: 3px solid #334155;
            border-top-color: #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 12px;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          .text { font-size: 14px; font-weight: 600; }
        </style>
      </head>
      <body>
        <div class="spinner"></div>
        <div class="text">Installing v${this.state.version}...</div>
      </body>
      </html>
    `)}`);
    win.show();
    win.focus();

    // Wait for window to show
    await new Promise(r => setTimeout(r, 500));
    
    // Close all other windows
    BrowserWindow.getAllWindows().forEach(w => {
      if (w !== win && !w.isDestroyed()) {
        w.destroy();
      }
    });

    // Run Squirrel to apply update
    const exeName = path.basename(process.execPath);
    spawn(this._updateExe, ['--processStart', exeName], {
      cwd: this._installDir,
      detached: true,
      stdio: 'ignore'
    }).unref();

    // Exit after delay
    setTimeout(() => {
      logger.info('Exiting for update...');
      if (!win.isDestroyed()) win.close();
      app.exit(0);
    }, 2000);
  }
}

module.exports = UpdateService;