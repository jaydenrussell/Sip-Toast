const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

let mainWindow;
let updateProcess = null;
let currentProgress = 0;
let isInstalling = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 500,
    height: 400,
    minWidth: 400,
    minHeight: 300,
    resizable: false,
    frame: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (updateProcess) {
    updateProcess.kill();
  }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

ipcMain.handle('update:install', async (event, packagesDir) => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(packagesDir)) {
      return reject(new Error('Packages directory not found'));
    }

    const updateExe = path.join(packagesDir, '..', 'Update.exe');
    if (!fs.existsSync(updateExe)) {
      return reject(new Error('Update.exe not found'));
    }

    isInstalling = true;
    updateProcess = spawn(updateExe, ['--update', packagesDir], {
      cwd: path.dirname(updateExe),
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    updateProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(output);
      const progressMatch = output.match(/Progress: (\d+)%/);
      if (progressMatch) {
        currentProgress = parseInt(progressMatch[1], 10);
        mainWindow.webContents.send('update:progress', currentProgress);
      }
    });

    updateProcess.stderr.on('data', (data) => {
      const error = data.toString();
      console.error(error);
      mainWindow.webContents.send('update:error', error);
    });

    updateProcess.on('close', (code) => {
      isInstalling = false;
      if (code === 0) {
        mainWindow.webContents.send('update:complete');
        resolve(true);
      } else {
        reject(new Error(`Update failed with exit code ${code}`));
      }
      updateProcess = null;
    });

    updateProcess.on('error', (error) => {
      isInstalling = false;
      reject(error);
      updateProcess = null;
    });
  });
});

ipcMain.handle('update:cancel', () => {
  if (updateProcess) {
    updateProcess.kill();
    updateProcess = null;
    currentProgress = 0;
    mainWindow.webContents.send('update:canceled');
    isInstalling = false;
    return true;
  }
  return false;
});

ipcMain.handle('update:get-packages-dir', () => {
  const args = process.argv.slice(1);
  const packagesDir = args.find(arg => arg.startsWith('--packages='));
  if (packagesDir) {
    return packagesDir.split('=')[1];
  }
  return null;
});

ipcMain.handle('update:restart-app', async () => {
  try {
    const packagesDir = await ipcMain.handle('update:get-packages-dir');
    if (!packagesDir) {
      throw new Error('Packages directory not found');
    }

    const appDir = path.dirname(packagesDir);
    const appExe = path.join(appDir, 'SIPCallerID.exe');

    if (!fs.existsSync(appExe)) {
      // Try to find the application in common locations
      const possiblePaths = [
        path.join(appDir, 'resources', 'app', 'SIPCallerID.exe'),
        path.join(appDir, '..', 'SIPCallerID.exe'),
        path.join(appDir, 'SIPCallerID.exe')
      ];

      for (const possiblePath of possiblePaths) {
        if (fs.existsSync(possiblePath)) {
          appExe = possiblePath;
          break;
        }
      }
    }

    if (!fs.existsSync(appExe)) {
      throw new Error(`Application executable not found at: ${appExe}`);
    }

    console.log(`Launching updated application: ${appExe}`);
    shell.openPath(appExe);
    return true;
  } catch (error) {
    console.error(`Failed to launch updated application: ${error.message}`);
    throw error;
  }
});