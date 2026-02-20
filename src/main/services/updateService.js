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

  _emit() {
    this.emit('update-status', this.getStatus());
  }

  _getUpdateExe() {
    if (!app.isPackaged) return null;
    const dir = path.dirname(path.dirname(path.dirname(app.getAppPath())));
    const p = path.join(dir, 'Update.exe');
    return fs.existsSync(p) ? p : null;
  }

  _getInstallDir() {
    return path.dirname(path.dirname(path.dirname(app.getAppPath())));
  }

  async _fetch() {
    return new Promise((resolve, reject) => {
      https.request({
        hostname: 'api.github.com',
        path: `/repos/${GITHUB.owner}/${GITHUB.repo}/releases/latest`,
        headers: { 'User-Agent': 'SIPToast', 'Accept': 'application/vnd.github.v3+json' },
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            resolve(res.statusCode === 200 ? JSON.parse(data) : null);
          } catch { resolve(null); }
        });
      }).on('error', () => resolve(null)).on('timeout', function() { this.destroy(); resolve(null); }).end();
    });
  }

  _newer(remote, local) {
    const r = remote.replace(/^v/, '').split('.').map(Number);
    const l = local.replace(/^v/, '').split('.').map(Number);
    return r[0] > l[0] || (r[0] === l[0] && r[1] > l[1]) || (r[0] === l[0] && r[1] === l[1] && r[2] > l[2]);
  }

  async _download(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
      https.request(url, { headers: { 'User-Agent': 'SIPToast' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return this._download(res.headers.location, dest, onProgress).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) return reject(new Error(res.statusCode));
        
        const total = +res.headers['content-length'] || 0;
        let done = 0, last = 0;
        const file = fs.createWriteStream(dest);
        
        res.on('data', c => {
          done += c.length;
          const now = Date.now();
          if (now - last > 300 && total) {
            last = now;
            onProgress?.(Math.round(done / total * 100));
          }
        }).pipe(file);
        
        file.on('finish', () => file.close(resolve));
        file.on('error', e => { fs.unlink(dest, () => {}); reject(e); });
      }).on('error', reject).end();
    });
  }

  async checkForUpdates() {
    if (this.state.checking || this.state.downloading) return this.getStatus();
    if (!app.isPackaged || !this._getUpdateExe()) return this.getStatus();

    this.state.checking = true;
    this._emit();

    const release = await this._fetch();
    this.state.checking = false;
    this.state.lastCheck = new Date();

    if (!release) {
      this._emit();
      return this.getStatus();
    }

    const version = release.tag_name.replace(/^v/, '');
    
    if (!this._newer(version, this.state.current)) {
      this._emit();
      return this.getStatus();
    }

    this.state.available = true;
    this.state.version = version;
    this.state.downloading = true;
    this.state.progress = 0;
    this._emit();

    const dir = path.join(this._getInstallDir(), 'packages');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const base = `https://github.com/${GITHUB.owner}/${GITHUB.repo}/releases/download/${release.tag_name}`;
    const files = [
      ['RELEASES', `${base}/RELEASES`],
      [`SIPToast-${version}-full.nupkg`, `${base}/SIPToast-${version}-full.nupkg`]
    ];

    // Check for delta
    try {
      const releasesPath = path.join(dir, 'RELEASES');
      await this._download(files[0][1], releasesPath, () => { this.state.progress = 5; this._emit(); });
      if (fs.readFileSync(releasesPath, 'utf8').includes(`SIPToast-${version}-delta.nupkg`)) {
        files.push([`SIPToast-${version}-delta.nupkg`, `${base}/SIPToast-${version}-delta.nupkg`]);
      }
    } catch {}

    // Download nupkg
    const nupkg = files.slice(1);
    for (let i = 0; i < nupkg.length; i++) {
      const [name, url] = nupkg[i];
      const dest = path.join(dir, name);
      
      if (fs.existsSync(dest) && fs.statSync(dest).size > 1e6) {
        this.state.progress = Math.round((i + 1) / nupkg.length * 100);
        this._emit();
        continue;
      }

      try {
        await this._download(url, dest, p => {
          this.state.progress = Math.round((i / nupkg.length + p / nupkg.length / 100) * 100);
          this._emit();
        });
      } catch {}
    }

    this.state.progress = 100;
    this.state.downloading = false;
    this.state.downloaded = true;
    this._emit();

    return this.getStatus();
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

  async quitAndInstall() {
    if (!this.state.downloaded) return;
    
    const exe = this._getUpdateExe();
    if (!exe) return;

    const win = new BrowserWindow({
      width: 320, height: 140,
      frame: false, alwaysOnTop: true,
      backgroundColor: '#1e293b',
      webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    win.loadURL(`data:text/html,${encodeURIComponent(`
      <html><head><style>
        body{font-family:Segoe UI;background:linear-gradient(135deg,#1e293b,#0f172a);color:#fff;
            display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh}
        .s{width:28px;height:28px;border:3px solid #334155;border-top-color:#3b82f6;
           border-radius:50%;animation:x 1s linear infinite;margin-bottom:12px}
        @keyframes x{to{transform:rotate(360deg}}
        .t{font-size:14px;font-weight:600}
      </style></head><body>
        <div class="s"></div>
        <div class="t">Installing v${this.state.version}...</div>
      </body></html>
    `)}`);
    win.show();

    await new Promise(r => setTimeout(r, 500));
    
    BrowserWindow.getAllWindows().forEach(w => w !== win && !w.isDestroyed() && w.destroy());

    spawn(exe, ['--processStart', path.basename(process.execPath)], {
      cwd: this._getInstallDir(),
      detached: true, stdio: 'ignore'
    }).unref();

    setTimeout(() => { win.close(); app.exit(0); }, 2000);
  }
}

module.exports = UpdateService;