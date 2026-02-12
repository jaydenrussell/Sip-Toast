const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trayAPI', {
  // Settings
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  
  // Logs
  getLogs: (count) => ipcRenderer.invoke('logs:tail', count),
  logAction: (message) => ipcRenderer.invoke('log:action', message),
  
  // SIP
  restartSip: () => ipcRenderer.invoke('sip:restart'),
  getSipStatus: () => ipcRenderer.invoke('sip:status:get'),
  testSipConnection: () => ipcRenderer.invoke('sip:test'),
  testAcuityConnection: () => ipcRenderer.invoke('acuity:test'),
  simulateCall: () => ipcRenderer.invoke('sim:incoming'),
  
  // Window
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  
  // App
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  
  // Events (consolidated)
  getRecentEvents: (count, filterType) => ipcRenderer.invoke('events:query', 'recent', count, filterType),
  getEventsByType: (type) => ipcRenderer.invoke('events:query', 'type', type),
  getAllEvents: (filterType) => ipcRenderer.invoke('events:query', 'all', filterType),
  getEventsInRange: (startDate, endDate) => ipcRenderer.invoke('events:query', 'range', startDate, endDate),
  getEventLogFilePath: () => ipcRenderer.invoke('events:query', 'path'),
  deleteAllEvents: () => ipcRenderer.invoke('events:query', 'delete'),
  
  // Firewall
  checkFirewall: () => ipcRenderer.invoke('firewall:check'),
  getFirewallInstructions: () => ipcRenderer.invoke('firewall:instructions'),
  
  // Updates (consolidated)
  checkForUpdates: () => ipcRenderer.invoke('updates:action', 'check'),
  checkForUpdatesGithub: () => ipcRenderer.invoke('updates:action', 'checkGithub'),
  downloadUpdate: () => ipcRenderer.invoke('updates:action', 'download'),
  installUpdate: () => ipcRenderer.invoke('updates:action', 'install'),
  getUpdateStatus: () => ipcRenderer.invoke('updates:action', 'status'),
  
  // Event listeners
  onLogEntry: (callback) => ipcRenderer.on('logs:entry', (_event, entry) => callback(entry)),
  onSipStatus: (callback) => ipcRenderer.on('sip:status', (_event, status) => callback(status)),
  onThemeChanged: (callback) => ipcRenderer.on('theme:changed', (_event, theme) => callback(theme)),
  
  // Update status listener
  onUpdateStatus: (callback) => ipcRenderer.on('update:status', (_event, status) => callback(status))
});
