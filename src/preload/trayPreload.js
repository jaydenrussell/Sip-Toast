const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trayAPI', {
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  getLogs: (count) => ipcRenderer.invoke('logs:tail', count),
  restartSip: () => ipcRenderer.invoke('sip:restart'),
  getSipStatus: () => ipcRenderer.invoke('sip:status:get'),
  testSipConnection: () => ipcRenderer.invoke('sip:test'),
  testAcuityConnection: () => ipcRenderer.invoke('acuity:test'),
  simulateCall: () => ipcRenderer.invoke('sim:incoming'),
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  logAction: (message) => ipcRenderer.invoke('log:action', message),
  onLogEntry: (callback) => {
    ipcRenderer.on('logs:entry', (_event, entry) => callback(entry));
  },
  onSipStatus: (callback) => {
    ipcRenderer.on('sip:status', (_event, status) => callback(status));
  },
  onThemeChanged: (callback) => {
    ipcRenderer.on('theme:changed', (_event, theme) => callback(theme));
  },
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getRecentEvents: (count, filterType) => ipcRenderer.invoke('events:getRecent', count, filterType),
  getEventsByType: (type) => ipcRenderer.invoke('events:getByType', type),
  getAllEvents: (filterType) => ipcRenderer.invoke('events:getAll', filterType),
  getEventsInRange: (startDate, endDate) => ipcRenderer.invoke('events:getInRange', startDate, endDate),
  getEventLogFilePath: () => ipcRenderer.invoke('events:getLogFilePath'),
  deleteAllEvents: () => ipcRenderer.invoke('events:deleteAll'),
  checkFirewall: () => ipcRenderer.invoke('firewall:check'),
  getFirewallInstructions: () => ipcRenderer.invoke('firewall:instructions'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  openUpdatePage: () => ipcRenderer.invoke('updates:openPage'),
  getUpdateStatus: () => ipcRenderer.invoke('updates:status'),
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update:status', (_event, status) => callback(status));
  }
});

