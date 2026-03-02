const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  invoke: {
    install: (packagesDir) => ipcRenderer.invoke('update:install', packagesDir),
    cancel: () => ipcRenderer.invoke('update:cancel'),
    getPackagesDir: () => ipcRenderer.invoke('update:get-packages-dir'),
    restartApp: () => ipcRenderer.invoke('update:restart-app')
  },
  on: {
    progress: (callback) => ipcRenderer.on('update:progress', callback),
    complete: (callback) => ipcRenderer.on('update:complete', callback),
    error: (callback) => ipcRenderer.on('update:error', callback),
    canceled: (callback) => ipcRenderer.on('update:canceled', callback)
  },
  send: {
    restart: () => ipcRenderer.send('update:restart')
  }
});
