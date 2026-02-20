const { logger } = require('./logger');
const { EventEmitter } = require('events');
const { app, BrowserWindow, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

const GITHUB_OWNER = 'jaydenrussell';
const GITHUB_REPO = 'Sip-Toast';

/**
 * Clean Update Service for Squirrel.Windows
 * 
 * Flow:
 * 1. Check for updates at startup (no auto-install)
 * 2. Download update in background
 * 3. Notify user when update is ready
 * 4. User clicks "Install" → Apply update and restart
 */
class UpdateService extends EventEmitter {
  constructor() {
    super();
    
    this.isChecking = false;
    this.isDownloading = false;
    this.updateAvailable = false;
    this.downloadProgress = 0;
    this.availableVersion = null;
    this.currentVersion = app.getVersion() || 'Unknown';
    this.updateDownloaded = false;
    this.hasCheckedOnStartup = false;
    this.lastCheckTime = null;
    
    logger.info(`📦 UpdateService initialized - v${this.currentVersion}`);
  }

  _getUpdateExePath() {
    if (!app.isPackaged) return null;
    
    const appPath = app.getAppPath();
    const installFolder = path.dirname(path.dirname(path.dirname(appPath)));
    
    const candidates = [
      path.join(installFolder, 'Update.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'SIPToast', 'Update.exe'),
    ];
    
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  _getInstallFolder() {
    const appPath = app.getAppPath();
    return path.dirname(path.dirname(path.dirname(appPath)));
  }

  async _fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': `SIPToast/${this.currentVersion}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`GitHub API: ${res.statusCode}`));
            }
          } catch (e) {
            reject(e);
          }
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      req.end();
    });
  }

  _isNewerVersion(remote, local) {
    const r = remote.replace(/^v/, '').split('.').map(Number);
    const l = local.replace(/^v/, '').split('.').map(Number);
    
    for (let i = 0; i < 3; i++) {
      if ((r[i] || 0) > (l[i] || 0)) return true;
      if ((r[i] || 0) < (l[i] || 0)) return false;
    }
    return false;
  }

  async _downloadFile(url, destPath, onProgress) {
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        headers: { 'User-Agent': `SIPToast/${this.currentVersion}` }
      }, (res) => {
        // Handle redirect
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._downloadFile(res.headers.location, destPath, onProgress).then(resolve).catch(reject);
        }
        
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        
        const total = parseInt(res.headers['content-length'], 10) || 0;
        let downloaded = 0;
        let lastTime = 0;
        
        const file = fs.createWriteStream(destPath);
        
        res.on('data', (chunk) => {
          downloaded += chunk.length;
          const now = Date.now();
          if (now - lastTime >= 250 && onProgress && total > 0) {
            lastTime = now;
            onProgress(Math.round((downloaded / total) * 100));
          }
        });
        
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
        file.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      });
      
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Timeout'));
      });
      req.end();
    });
  }

  async _downloadUpdate(releaseTag) {
    const packagesDir = path.join(this._getInstallFolder(), 'packages');
    
    if (!fs.existsSync(packagesDir)) {
      fs.mkdirSync(packagesDir, { recursive: true });
    }
    
    const baseUrl = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/download/${releaseTag}`;
    const files = [
      { name: 'RELEASES', url: `${baseUrl}/RELEASES` },
      { name: `SIPToast-${this.availableVersion}-full.nupkg`, url: `${baseUrl}/SIPToast-${this.availableVersion}-full.nupkg` }
    ];
    
    logger.info(`📥 Downloading update v${this.availableVersion}...`);
    
    // Download RELEASES first
    try {
      await this._downloadFile(files[0].url, path.join(packagesDir, files[0].name), () => {
        this.downloadProgress = 5;
        this.emitStatus();
      });
      
      // Check for delta
      const releasesContent = fs.readFileSync(path.join(packagesDir, 'RELEASES'), 'utf8');
      if (releasesContent.includes(`SIPToast-${this.availableVersion}-delta.nupkg`)) {
        files.push({
          name: `SIPToast-${this.availableVersion}-delta.nupkg`,
          url: `${baseUrl}/SIPToast-${this.availableVersion}-delta.nupkg`
        });
      }
    } catch (e) {
      logger.warn(`RELEASES download failed: ${e.message}`);
    }
    
    // Download nupkg files
    const nupkgFiles = files.slice(1);
    for (let i = 0; i < nupkgFiles.length; i++) {
      const file = nupkgFiles[i];
      const destPath = path.join(packagesDir, file.name);
      
      // Skip if already downloaded
      if (fs.existsSync(destPath) && fs.statSync(destPath).size > 1000000) {
        logger.info(`   ✓ ${file.name} already exists`);
        this.downloadProgress = Math.round(((i + 1) / nupkgFiles.length) * 100);
        this.emitStatus();
        continue;
      }
      
      await this._downloadFile(file.url, destPath, (progress) => {
        this.downloadProgress = Math.round(((i / nupkgFiles.length) * 100) + (progress / nupkgFiles.length));
        this.emitStatus();
      });
      
      logger.info(`   ✓ ${file.name}`);
    }
    
    this.downloadProgress = 100;
    this.emitStatus();
  }

  async checkForUpdates(trigger = 'manual') {
    if (this.isChecking || this.isDownloading) {
      return this.getStatus();
    }
    
    if (!app.isPackaged) {
      logger.info('⚠️ Skipping update check (dev mode)');
      return this.getStatus();
    }
    
    const updateExe = this._getUpdateExePath();
    if (!updateExe) {
      logger.warn('⚠️ Update.exe not found');
      return this.getStatus();
    }
    
    this.isChecking = true;
    this.emitStatus();
    
    logger.info(`🔍 Checking for updates... (current: v${this.currentVersion})`);
    
    try {
      const release = await this._fetchLatestRelease();
      const remoteVersion = release.tag_name.replace(/^v/, '');
      
      this.isChecking = false;
      this.lastCheckTime = new Date();
      
      logger.info(`📦 Latest: v${remoteVersion}`);
      
      if (this._isNewerVersion(remoteVersion, this.currentVersion)) {
        logger.info(`📥 Update available: v${remoteVersion}`);
        
        this.availableVersion = remoteVersion;
        this.updateAvailable = true;
        this.isDownloading = true;
        this.downloadProgress = 0;
        this.emitStatus();
        
        // Download update
        try {
          await this._downloadUpdate(release.tag_name);
          
          this.updateDownloaded = true;
          this.isDownloading = false;
          
          logger.info(`✅ Update v${remoteVersion} ready to install`);
          this.emitStatus();
          
          // DON'T auto-install - let user decide
          // This prevents the update loop
          
        } catch (downloadError) {
          logger.error(`❌ Download failed: ${downloadError.message}`);
          this.isDownloading = false;
          this.updateAvailable = false;
          this.emitStatus();
        }
      } else {
        logger.info(`✅ Up to date`);
        this.updateAvailable = false;
        this.emitStatus();
      }
      
      return this.getStatus();
      
    } catch (error) {
      logger.error(`❌ Update check failed: ${error.message}`);
      this.isChecking = false;
      this.isDownloading = false;
      this.emitStatus();
      return this.getStatus();
    }
  }

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

  startAutoCheck() {
    if (this.hasCheckedOnStartup) return;
    this.hasCheckedOnStartup = true;
    
    // Check after 5 seconds (let app fully load first)
    setTimeout(() => {
      this.checkForUpdates('app_load');
    }, 5000);
    
    logger.info('📅 Update check scheduled');
  }

  restartAutoCheck() {
    this.hasCheckedOnStartup = false;
    this.startAutoCheck();
  }

  /**
   * Install the downloaded update
   * This is called when user clicks "Install Update"
   */
  async quitAndInstall() {
    if (!this.updateDownloaded) {
      logger.warn('No update ready');
      return;
    }
    
    const updateExe = this._getUpdateExePath();
    if (!updateExe) {
      logger.error('Update.exe not found');
      return;
    }
    
    logger.info(`🔄 Installing update v${this.availableVersion}...`);
    
    // Show installing window
    const installWindow = this._showInstallWindow();
    
    // Give window time to show
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Close all windows except install window
    BrowserWindow.getAllWindows().forEach(win => {
      if (win !== installWindow && !win.isDestroyed()) {
        win.destroy();
      }
    });
    
    // Run Squirrel to apply update
    const exeName = path.basename(process.execPath);
    const installFolder = this._getInstallFolder();
    
    logger.info(`   Running: Update.exe --processStart ${exeName}`);
    
    const proc = spawn(updateExe, ['--processStart', exeName], {
      cwd: installFolder,
      detached: true,
      stdio: 'ignore'
    });
    
    proc.unref();
    
    // Wait a moment then exit
    setTimeout(() => {
      logger.info('🚪 Exiting for update...');
      if (installWindow && !installWindow.isDestroyed()) {
        installWindow.close();
      }
      app.exit(0);
    }, 2000);
  }

  _showInstallWindow() {
    const win = new BrowserWindow({
      width: 350,
      height: 150,
      frame: false,
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: false,
      transparent: false,
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
        <meta charset="UTF-8">
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
            width: 32px;
            height: 32px;
            border: 3px solid #334155;
            border-top-color: #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 16px;
          }
          @keyframes spin { to { transform: rotate(360deg); } }
          .title { font-size: 16px; font-weight: 600; }
          .version { font-size: 12px; color: #94a3b8; margin-top: 8px; }
        </style>
      </head>
      <body>
        <div class="spinner"></div>
        <div class="title">Installing Update</div>
        <div class="version">SIP Toast v${this.availableVersion}</div>
      </body>
      </html>
    `)}`);
    
    win.show();
    win.focus();
    
    return win;
  }
}

module.exports = UpdateService;