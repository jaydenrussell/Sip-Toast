const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notificationAPI', {
  onData: (callback) => {
    ipcRenderer.removeAllListeners('notification:data');
    ipcRenderer.on('notification:data', (_event, payload) => callback(payload));
  },
  hide: () => ipcRenderer.send('toast-clicked'),
  copyToClipboard: (text) => {
    return ipcRenderer.invoke('clipboard:write', text);
  },
  notifyClick: (phoneNumber, success) => {
    ipcRenderer.send('toast-clicked', phoneNumber, success);
  },
  closeWindow: () => {
    ipcRenderer.send('toast:close');
  }
});

