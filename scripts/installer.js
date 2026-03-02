const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const axios = require('axios');

let mainWindow;
let updateWindow;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 300,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('src/renderer/installer.html');
}

function createUpdateWindow() {
  updateWindow = new BrowserWindow({
    width: 500,
    height: 400,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  updateWindow.loadFile('src/renderer/update.html');
}

ipcMain.handle('check-for-updates', async () => {
  try {
    const response = await axios.get('https://api.github.com/repos/jaydenrussell/Sip-Toast/releases/latest');
    const latestRelease = response.data;
    const currentVersion = require('../package.json').version;

    if (latestRelease.tag_name.replace('v', '') !== currentVersion) {
      return {
        hasUpdate: true,
        version: latestRelease.tag_name.replace('v', ''),
        releaseNotes: latestRelease.body,
        downloadUrl: latestRelease.assets[0].browser_download_url
      };
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
  }

  return { hasUpdate: false };
});

ipcMain.handle('download-update', async (event, downloadUrl) => {
  const downloadPath = path.join(app.getPath('temp'), 'SIPCallerID-Setup.exe');
  const writer = fs.createWriteStream(downloadPath);

  const response = await axios({
    url: downloadUrl,
    method: 'GET',
    responseType: 'stream'
  });

  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', () => resolve(downloadPath));
    writer.on('error', reject);
  });
});

ipcMain.handle('install-update', (event, installerPath) => {
  const { exec } = require('child_process');
  exec(`"${installerPath}"`, (error, stdout, stderr) => {
    if (error) {
      console.error('Error installing update:', error);
      return;
    }
    console.log('Update installed successfully');
  });
});

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});