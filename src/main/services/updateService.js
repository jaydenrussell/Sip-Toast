const { logger } = require('./logger');
const { EventEmitter } = require('events');
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { spawn } = require('child_process');

const GITHUB = { owner: 'jaydenrussell', repo: 'Sip-Toast' };

// Expected minimum file sizes for validation (in bytes)
const MIN_FILE_SIZES = {
  RELEASES: 100,
  full: 50000000,    // 50MB minimum for full package
  delta: 1000000     // 1MB minimum for delta package
};

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
      lastCheck: null,
      error: null,
      downloadSpeed: null
    };
    this._checked = false;
    this._installDir = null;
    this._updateExe = null;
    this._abortController = null;
    
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
      lastCheckTime: this.state.lastCheck,
      error: this.state.error,
      downloadSpeed: this.state.downloadSpeed
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

  clearError() {
    this.state.error = null;
  }

  async _fetch(url, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
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
                } else if (res.statusCode === 403 && res.headers['x-ratelimit-remaining'] === '0') {
                  reject(new Error('GitHub API rate limit exceeded. Please try again later.'));
                } else {
                  reject(new Error(`HTTP ${res.statusCode}`));
                }
              } catch (e) {
                reject(e);
              }
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
          req.end();
        });
      } catch (error) {
        if (attempt === retries) throw error;
        logger.warn(`Fetch attempt ${attempt}/${retries} failed: ${error.message}. Retrying...`);
        await new Promise(r => setTimeout(r, 1000 * attempt)); // Exponential backoff
      }
    }
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

  async _download(url, dest, onProgress, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const req = https.request(url, { headers: { 'User-Agent': 'SIPToast' } }, (res) => {
            // Handle redirects (GitHub releases redirect to S3)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              return this._download(res.headers.location, dest, onProgress, retries).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`HTTP ${res.statusCode}`));
            }
            
            const total = parseInt(res.headers['content-length'], 10) || 0;
            let done = 0;
            let lastEmit = 0;
            let startTime = Date.now();
            let lastBytes = 0;
            
            // Ensure directory exists
            const dir = path.dirname(dest);
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }
            
            // Write to temp file first, then rename
            const tempPath = dest + '.tmp';
            const file = fs.createWriteStream(tempPath);
            
            res.on('data', chunk => {
              done += chunk.length;
              const now = Date.now();
              
              // Calculate download speed every second
              if (now - lastEmit > 500 && total > 0) {
                lastEmit = now;
                const elapsed = (now - startTime) / 1000;
                const speed = done / elapsed;
                this.state.downloadSpeed = this._formatSpeed(speed);
                onProgress?.(Math.round(done / total * 100));
              }
            });
            
            res.pipe(file);
            
            file.on('finish', () => {
              file.close();
              
              // Validate file size
              const stats = fs.statSync(tempPath);
              if (total > 0 && stats.size !== total) {
                fs.unlinkSync(tempPath);
                return reject(new Error(`Incomplete download: ${stats.size} of ${total} bytes`));
              }
              
              // Rename temp file to final destination
              try {
                if (fs.existsSync(dest)) {
                  fs.unlinkSync(dest);
                }
                fs.renameSync(tempPath, dest);
              } catch (e) {
                // If rename fails, try copy
                fs.copyFileSync(tempPath, dest);
                fs.unlinkSync(tempPath);
              }
              
              this.state.downloadSpeed = null;
              onProgress?.(100);
              resolve({ size: stats.size, total });
            });
            
            file.on('error', err => {
              fs.unlink(tempPath, () => {});
              reject(err);
            });
          });
          
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
          req.setTimeout(60000); // 60 second timeout per file
          req.end();
        });
      } catch (error) {
        if (attempt === retries) throw error;
        logger.warn(`Download attempt ${attempt}/${retries} failed: ${error.message}. Retrying...`);
        await new Promise(r => setTimeout(r, 2000 * attempt));
      }
    }
  }

  _formatSpeed(bytesPerSecond) {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  }

  _validateFile(filePath, type) {
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: 'File does not exist' };
    }
    
    const stats = fs.statSync(filePath);
    const minSize = MIN_FILE_SIZES[type] || 0;
    
    if (stats.size < minSize) {
      return { valid: false, error: `File too small: ${stats.size} bytes (expected at least ${minSize})` };
    }
    
    return { valid: true, size: stats.size };
  }

  _cleanupOldPackages(packagesDir, currentVersion) {
    try {
      if (!fs.existsSync(packagesDir)) return;
      
      const files = fs.readdirSync(packagesDir);
      let cleaned = 0;
      
      for (const file of files) {
        // Keep RELEASES and current version files
        if (file === 'RELEASES') continue;
        if (file.includes(currentVersion)) continue;
        
        // Remove old nupkg files
        if (file.endsWith('.nupkg') || file.endsWith('.nupkg.tmp')) {
          const filePath = path.join(packagesDir, file);
          try {
            fs.unlinkSync(filePath);
            cleaned++;
            logger.info(`Cleaned up old file: ${file}`);
          } catch (e) {
            logger.warn(`Failed to clean up ${file}: ${e.message}`);
          }
        }
      }
      
      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} old update file(s)`);
      }
    } catch (e) {
      logger.warn(`Cleanup failed: ${e.message}`);
    }
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
      logger.warn('Update.exe not found - updates not available');
      this.setError('Update system not available (portable install?)');
      return this.getStatus();
    }

    this.clearError();
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
      this.state.downloaded = false;
      this.emitStatus();

      // Download in background
      const success = await this._downloadUpdate(release.tag_name);
      
      if (success) {
        this.state.downloading = false;
        this.state.downloaded = true;
        this.state.progress = 100;
        logger.info(`Update v${version} downloaded and ready to install`);
        this.emitStatus();
      } else {
        this.state.downloading = false;
        this.state.downloaded = false;
        this.emitStatus();
      }

    } catch (error) {
      logger.error(`Update check failed: ${error.message}`);
      this.state.checking = false;
      this.state.downloading = false;
      this.setError(error.message);
    }

    return this.getStatus();
  }

  async _downloadUpdate(tag) {
    const packagesDir = path.join(this._installDir, 'packages');
    const version = this.state.version;
    
    // Create packages directory
    if (!fs.existsSync(packagesDir)) {
      fs.mkdirSync(packagesDir, { recursive: true });
    }

    // Clean up old packages first
    this._cleanupOldPackages(packagesDir, this.state.current);

    const baseUrl = `https://github.com/${GITHUB.owner}/${GITHUB.repo}/releases/download/${tag}`;
    
    // Download RELEASES file first
    const releasesPath = path.join(packagesDir, 'RELEASES');
    let hasDelta = false;
    
    try {
      logger.info('Downloading RELEASES manifest...');
      await this._download(`${baseUrl}/RELEASES`, releasesPath, p => {
        this.state.progress = Math.round(p * 0.02); // 0-2%
        this.emitStatus();
      });
      
      // Validate RELEASES file
      const validation = this._validateFile(releasesPath, 'RELEASES');
      if (!validation.valid) {
        throw new Error(`RELEASES file invalid: ${validation.error}`);
      }
      
      // Check for delta package
      const releasesContent = fs.readFileSync(releasesPath, 'utf8');
      hasDelta = releasesContent.includes(`SIPToast-${version}-delta.nupkg`);
      if (hasDelta) {
        logger.info('Delta update available (smaller download)');
      } else {
        logger.info('Full update required');
      }
    } catch (e) {
      this.setError(`Failed to download RELEASES: ${e.message}`);
      return false;
    }

    // Determine which files to download
    const files = [];
    
    // Always download full package (fallback if delta fails)
    files.push({ 
      name: `SIPToast-${version}-full.nupkg`, 
      type: 'full',
      required: true
    });
    
    // Download delta if available (smaller)
    if (hasDelta) {
      files.push({ 
        name: `SIPToast-${version}-delta.nupkg`, 
        type: 'delta',
        required: false
      });
    }

    // Download files
    let downloadedFiles = [];
    const totalWeight = 98; // 2% used for RELEASES
    const weightPerFile = totalWeight / files.length;
    let currentProgress = 2;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const destPath = path.join(packagesDir, file.name);
      
      // Check if file already exists and is valid
      const existingValidation = this._validateFile(destPath, file.type);
      if (existingValidation.valid) {
        logger.info(`${file.name} already downloaded (${this._formatSize(existingValidation.size)})`);
        currentProgress += weightPerFile;
        this.state.progress = Math.round(currentProgress);
        this.emitStatus();
        downloadedFiles.push({ name: file.name, path: destPath, size: existingValidation.size });
        continue;
      }

      logger.info(`Downloading ${file.name}...`);
      const startProgress = currentProgress;
      
      try {
        const result = await this._download(`${baseUrl}/${file.name}`, destPath, p => {
          this.state.progress = Math.round(startProgress + (p * weightPerFile / 100));
          this.emitStatus();
        });
        
        // Validate downloaded file
        const validation = this._validateFile(destPath, file.type);
        if (!validation.valid) {
          throw new Error(`Downloaded file invalid: ${validation.error}`);
        }
        
        logger.info(`${file.name} downloaded successfully (${this._formatSize(result.size)})`);
        downloadedFiles.push({ name: file.name, path: destPath, size: result.size });
        
      } catch (e) {
        logger.error(`Failed to download ${file.name}: ${e.message}`);
        
        // If required file fails, try to continue with other files
        if (file.required) {
          // Check if we have a valid existing file
          if (!existingValidation.valid) {
            this.setError(`Failed to download ${file.name}: ${e.message}`);
            return false;
          }
        }
      }
      
      currentProgress += weightPerFile;
      this.state.progress = Math.round(currentProgress);
      this.emitStatus();
    }

    // Verify we have at least the full package
    const fullPackage = downloadedFiles.find(f => f.type === 'full');
    if (!fullPackage) {
      this.setError('Full update package not available');
      return false;
    }

    logger.info(`Update packages ready: ${downloadedFiles.map(f => f.name).join(', ')}`);
    return true;
  }

  _formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  startAutoCheck() {
    if (this._checked) return;
    this._checked = true;
    
    logger.info('Scheduling automatic update check...');
    
    // Check after 5 seconds (let app fully initialize)
    setTimeout(() => {
      logger.info('Running automatic update check...');
      this.checkForUpdates('auto');
    }, 5000);
  }

  restartAutoCheck() {
    this._checked = false;
    this.startAutoCheck();
  }

  async quitAndInstall() {
    if (!this.state.downloaded) {
      logger.warn('No update ready to install');
      this.setError('No update ready to install');
      return;
    }
    
    if (!fs.existsSync(this._updateExe)) {
      logger.error('Update.exe not found');
      this.setError('Update system not available');
      return;
    }

    // Verify packages exist
    const packagesDir = path.join(this._installDir, 'packages');
    const version = this.state.version;
    const fullPackage = path.join(packagesDir, `SIPToast-${version}-full.nupkg`);
    
    if (!fs.existsSync(fullPackage)) {
      logger.error('Update package not found');
      this.setError('Update package not found. Please try downloading again.');
      this.state.downloaded = false;
      this.emitStatus();
      return;
    }

    logger.info(`Installing update v${version}...`);
    
    // Emit installing event so main.js can set isAppQuitting flag
    this.emit('installing');

    // Show install window with progress
    const win = new BrowserWindow({
      width: 360,
      height: 160,
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
            padding: 20px;
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
          .text { 
            font-size: 15px; 
            font-weight: 600;
            text-align: center;
          }
          .subtext {
            font-size: 12px;
            color: #94a3b8;
            margin-top: 8px;
          }
        </style>
      </head>
      <body>
        <div class="spinner"></div>
        <div class="text">Installing v${version}...</div>
        <div class="subtext">The app will restart automatically</div>
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

    // Log installation details
    const exeName = path.basename(process.execPath);
    logger.info(`Install directory: ${this._installDir}`);
    logger.info(`Packages directory: ${packagesDir}`);
    logger.info(`Update.exe: ${this._updateExe}`);
    logger.info(`Executable: ${exeName}`);
    
    // List files in packages directory
    try {
      if (fs.existsSync(packagesDir)) {
        const files = fs.readdirSync(packagesDir);
        logger.info(`Packages folder: ${files.join(', ')}`);
      } else {
        logger.error('Packages directory does not exist!');
      }
    } catch (e) {
      logger.error(`Error reading packages directory: ${e.message}`);
    }
    
    logger.info(`Launching Update.exe to apply update...`);
    
    // Use --processStartAndWait which will:
    // 1. Check for and apply any pending updates from packages folder
    // 2. Start the specified executable
    // 3. Wait for it to exit (so it can clean up)
    try {
      const updateProcess = spawn(this._updateExe, [
        '--processStartAndWait', exeName
      ], {
        cwd: this._installDir,
        detached: true,
        stdio: 'ignore'
      });
      
      updateProcess.on('error', (err) => {
        logger.error(`Update.exe spawn error: ${err.message}`);
      });
      
      updateProcess.unref();
    } catch (err) {
      logger.error(`Failed to launch Update.exe: ${err.message}`);
    }

    // Exit after delay to let Update.exe start
    setTimeout(() => {
      logger.info('Exiting for update installation...');
      if (!win.isDestroyed()) win.close();
      app.exit(0);
    }, 1500);
  }
}

module.exports = UpdateService;