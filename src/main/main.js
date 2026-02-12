const { app, Tray, Menu, nativeImage, ipcMain, clipboard, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const SipManager = require('./sip/sipManager');
const NotificationWindow = require('./notification/notificationWindow');
const TrayWindow = require('./tray/trayWindow');
// Lazy load Acuity client only when enabled (memory optimization)
let acuityClient = null;
const getAcuityClient = () => {
  if (!acuityClient) {
    acuityClient = require('./services/acuityClient');
  }
  return acuityClient;
};

const { logger, logEmitter, getRecentLogs } = require('./services/logger');
const { checkFirewallStatus, getFirewallInstructions } = require('./services/firewallChecker');
const settings = require('./settings');
const UpdateService = require('./services/updateService');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let tray;
let notificationWindow;
let sipManager;
let flyoutWindow;
// Removed unused mainWindow variable - flyoutWindow.window is used directly
let latestSipStatus = { state: 'idle', timestamp: new Date().toISOString() };
let updateService = null;

// Cache settings to avoid repeated lookups (memory-optimized)
// Initialize after store is ready - will be populated in wireIpc()
let cachedSettings = null;

const refreshCachedSettings = () => {
  cachedSettings = settings.getAll();
};
settings.store.onDidChange('sip', () => { cachedSettings.sip = settings.get('sip'); });
settings.store.onDidChange('acuity', () => { cachedSettings.acuity = settings.get('acuity'); });
settings.store.onDidChange('callerId', () => { cachedSettings.callerId = settings.get('callerId'); });
settings.store.onDidChange('toast', () => { cachedSettings.toast = settings.get('toast'); });
settings.store.onDidChange('app', () => { cachedSettings.app = settings.get('app'); });
settings.store.onDidChange('updates', () => { 
  cachedSettings.updates = settings.get('updates');
  // Restart auto-check when update settings change
  if (updateService) {
    updateService.restartAutoCheck();
  }
});

const simulateIncomingCall = async () => {
  const fakeCall = {
    displayName: 'Demo Caller',
    number: '+1 (555) 123-4567',
    normalizedNumber: '5551234567',
    timestamp: new Date().toISOString()
  };

  logger.info('🧪 Test SIP call simulation initiated');
  logger.info(`📞 Simulated call from: ${fakeCall.displayName} (${fakeCall.number})`);
  
  // Check if APIs are configured - use cached settings
  const acuityConfig = cachedSettings.acuity || {};
  const hasAcuity = acuityConfig?.enabled && acuityConfig?.userId && acuityConfig?.apiKey;
  
  // Perform lookups in parallel for better performance
  const lookupPromises = [];
  
  if (hasAcuity) {
    logger.info(`🔍 Performing lookups for phone number: ${fakeCall.normalizedNumber}`);
    logger.info('   Using Acuity API');
    const { lookupClientByPhone } = getAcuityClient();
    lookupPromises.push(lookupClientByPhone(fakeCall.normalizedNumber));
  } else {
    lookupPromises.push(Promise.resolve({ found: false, clientName: null, appointmentTime: null }));
  }
  
  // Execute lookups in parallel
  const [acuityResult] = await Promise.all(lookupPromises);
  
  let acuity = acuityResult;
  
  if (hasAcuity) {
    if (acuity.found) {
      logger.info(`✅ Lookup found client: ${acuity.clientName}`);
      if (acuity.appointmentTime) {
        logger.info(`   📅 Next appointment: ${acuity.appointmentTime}`);
      } else {
        logger.info('   📅 No upcoming appointment found');
      }
    } else {
      logger.info('❌ Lookup: No client match found for test number');
      logger.info('   (This is expected - test number may not exist in your account)');
    }
  } else {
    logger.info('📝 Acuity API not enabled - client info will not be shown');
  }
  
  // Get toast timeout from cached settings
  const toastTimeout = cachedSettings.toast?.autoDismissMs || 20000;
  logger.info(`🔔 Showing simulated toast notification (will auto-dismiss in ${toastTimeout / 1000} seconds)`);
  
  notificationWindow.show({
    callerLabel: fakeCall.displayName,
    phoneNumber: fakeCall.number,
    clientName: hasAcuity && acuity.found ? acuity.clientName : null,
    appointmentTime: hasAcuity ? acuity.appointmentTime : null,
    lookupState: hasAcuity && acuity.found ? 'match' : 'unknown',
    acuityConfigured: hasAcuity, // Indicate if Acuity API is configured
    timestamp: fakeCall.timestamp,
    simulated: true
  });
  
  return true;
};

const resolveIconPath = () => {
  if (app.isPackaged) {
    // In packaged app, try multiple possible locations
    // extraResources copies Images to resources/Images
    const possiblePaths = [
      path.join(process.resourcesPath, 'Images', 'app.ico'), // extraResources location
      path.join(process.resourcesPath, 'app.asar', 'Images', 'app.ico'), // Inside asar
      path.join(__dirname, '..', '..', 'Images', 'app.ico'), // Relative to main.js
      path.join(process.execPath, '..', 'resources', 'Images', 'app.ico'), // Next to executable
      path.join(process.execPath, '..', 'Images', 'app.ico') // Alternative location
    ];
    
    for (const iconPath of possiblePaths) {
      if (fs.existsSync(iconPath)) {
        logger.info(`✅ Found icon at: ${iconPath}`);
        return iconPath;
      }
    }
    
    // If not found, return the most likely path (extraResources location)
    return path.join(process.resourcesPath, 'Images', 'app.ico');
  } else {
    // In development, use the project Images folder
    return path.join(__dirname, '..', '..', 'Images', 'app.ico');
  }
};

const createTrayIcon = () => {
  const iconPath = resolveIconPath();
  let icon;
  
  try {
    logger.info(`🔍 Looking for tray icon at: ${iconPath}`);
    
    // Try ICO first
    if (fs.existsSync(iconPath)) {
      logger.info(`✅ Found icon file: ${iconPath}`);
      icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        // Resize to appropriate tray icon size (16x16 or 32x32 for Windows)
        const sizes = icon.getSize();
        logger.info(`   Icon size: ${sizes.width}x${sizes.height}`);
        
        // On Windows, ensure icon is not treated as template (which makes it transparent)
        if (process.platform === 'win32') {
          icon.setTemplateImage(false);
        }
        
        // Resize to 16x16 for system tray (Windows standard)
        if (sizes.width !== 16 || sizes.height !== 16) {
          icon = icon.resize({ width: 16, height: 16 });
        }
        
        return icon;
      } else {
        logger.warn(`⚠️ Icon file exists but is empty: ${iconPath}`);
      }
    } else {
      logger.warn(`⚠️ Icon file not found: ${iconPath}`);
    }
    
    // Try PNG as fallback
    const pngPath = iconPath.replace('.ico', '.png');
    if (fs.existsSync(pngPath)) {
      logger.info(`✅ Found PNG fallback: ${pngPath}`);
      icon = nativeImage.createFromPath(pngPath);
      if (!icon.isEmpty()) {
        if (process.platform === 'win32') {
          icon.setTemplateImage(false);
        }
        // Resize to 16x16
        icon = icon.resize({ width: 16, height: 16 });
        return icon;
      }
    }
    
    throw new Error(`Icon files not found at ${iconPath} or ${pngPath}`);
  } catch (error) {
    logger.error(`❌ Failed to load icon from ${iconPath}: ${error.message}`);
    logger.error(`   Creating fallback icon...`);
    
    // Create a simple colored square icon as last resort
    const size = 16;
    const pixelData = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      const idx = i * 4;
      pixelData[idx] = 37;     // R - blue
      pixelData[idx + 1] = 99;  // G
      pixelData[idx + 2] = 235; // B
      pixelData[idx + 3] = 255; // A
    }
    icon = nativeImage.createFromBuffer(pixelData, { width: size, height: size });
    if (process.platform === 'win32') {
      icon.setTemplateImage(false);
    }
    return icon;
  }
};

const applyAutoLaunch = () => {
  const launchAtLogin = settings.get('app.launchAtLogin', true);
  app.setLoginItemSettings({
    openAtLogin: Boolean(launchAtLogin),
    path: process.execPath,
    args: []
  });
};

const createTray = () => {
  if (tray) return tray;
  const icon = createTrayIcon();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Control Center',
      click: () => flyoutWindow?.showStandalone()
    },
    {
      label: 'Refresh SIP Connection',
      click: async () => {
        await sipManager?.start();
      }
    },
    {
      label: 'Quit',
      click: () => {
        // Force quit - destroy all windows and resources
        if (notificationWindow?.window) {
          notificationWindow.window.destroy();
          notificationWindow = null;
        }
        if (flyoutWindow?.window) {
          flyoutWindow.window.destroy();
          flyoutWindow = null;
        }
        if (sipManager) {
          sipManager.stop();
          sipManager = null;
        }
        if (tray) {
          tray.destroy();
          tray = null;
        }
        // Use exit instead of quit to force termination
        app.exit(0);
      }
    }
  ]);

  tray.setToolTip('SIP Toast – Caller ID Lookup');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    // Always show in standalone mode (not docked) so it stays visible
    if (flyoutWindow?.window?.isVisible()) {
      // If already visible, just focus it
      flyoutWindow.window.focus();
    } else {
      flyoutWindow?.showStandalone();
    }
  });
  tray.on('double-click', () => {
    flyoutWindow?.showStandalone();
  });
  return tray;
};

// Consolidated IPC handlers for better performance
// Batches similar handlers to reduce code duplication
const wireIpc = () => {
  // Initialize cached settings first (after store is ready)
  refreshCachedSettings();
  
  // ==========================================
  // APP INFO HANDLERS
  // ==========================================
  ipcMain.handle('app:info', () => {
    const appName = app.getName() || 'SIP Toast';
    const version = app.getVersion() || 'Unknown';
    
    let buildDate = 'Unknown';
    try {
      const appPath = app.getAppPath();
      const packageJsonPath = path.join(appPath, 'package.json');
      if (fs.existsSync(packageJsonPath)) {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        if (pkg?.buildDate) {
          const date = new Date(pkg.buildDate);
          if (!isNaN(date.getTime())) {
            buildDate = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
          }
        }
      }
    } catch { /* Silently fail */ }
    
    return { appName, version, buildDate };
  });

  // ==========================================
  // SETTINGS HANDLERS - Optimized with caching
  // ==========================================
  ipcMain.handle('settings:get', (_event, key) => settings.get(key));
  ipcMain.handle('settings:getAll', () => cachedSettings);
  
  ipcMain.handle('settings:save', (_event, payload) => {
    const saved = settings.save(payload || {});
    cachedSettings = settings.getAll();
    
    // Handle each section efficiently
    if (payload.sip) {
      logger.info(`💾 SIP settings saved: ${saved.sip?.server || 'N/A'}`);
      setTimeout(() => sipManager?.updateConfig(saved.sip), 100);
    }
    if (payload.acuity) logger.info(`💾 Acuity settings saved`);
    if (payload.callerId) logger.info(`💾 Caller ID settings saved`);
    if (payload.app) { applyAutoLaunch(); logger.info(`💾 App settings saved`); }
    if (payload.toast) logger.info(`💾 Toast settings saved`);
    if (payload.updates) { updateService?.restartAutoCheck(); logger.info(`💾 Update settings saved`); }
    
    return saved;
  });

  // ==========================================
  // LOG HANDLERS
  // ==========================================
  ipcMain.handle('logs:tail', (_event, count) => getRecentLogs(count));
  ipcMain.handle('log:action', (_event, message) => { logger.info(message); return true; });

  // ==========================================
  // SIP HANDLERS - Optimized
  // ==========================================
  ipcMain.handle('sip:restart', async () => {
    sipManager?.stop();
    setTimeout(() => sipManager?.start(), 500);
    return true;
  });

  ipcMain.handle('sip:status:get', () => latestSipStatus);
  
  ipcMain.handle('sip:health:check', () => {
    return sipManager ? sipManager.checkHealth() : { healthy: false, issue: 'Not initialized' };
  });

  ipcMain.handle('sip:test', async () => {
    const sipConfig = cachedSettings.sip || {};
    if (!sipConfig.server || !sipConfig.username || !sipConfig.password) {
      return { success: false, message: 'SIP settings incomplete', status: 'Incomplete' };
    }

    try {
      // Parallel DNS lookup with timeout
      const dns = require('dns').promises;
      const serverHost = sipConfig.server.split(':')[0].replace(/^sips?:\/\//, '').split('/')[0];
      const addresses = await Promise.race([
        dns.lookup(serverHost, { all: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 3000))
      ]);
      
      const ipAddress = addresses?.map?.(a => a.address).join(', ') || 'Unknown';
      const domain = sipConfig.domain || serverHost;
      const transport = sipConfig.transport || 'udp';
      const sipUri = `${transport === 'tls' ? 'sips' : 'sip'}:${sipConfig.username}@${domain}`;
      const currentState = sipManager?.getState() || 'idle';
      
      return {
        success: currentState === 'registered',
        message: currentState === 'registered' ? 'SIP connection is active' : `Status: ${currentState}`,
        status: currentState.charAt(0).toUpperCase() + currentState.slice(1),
        server: sipConfig.server,
        port: sipConfig.port || 5060,
        transport,
        dns: 'Success',
        ip: ipAddress,
        username: sipConfig.username,
        uri: sipUri
      };
    } catch (error) {
      return { success: false, message: 'Test failed', error: error.message, status: 'Error' };
    }
  });

  ipcMain.handle('sim:incoming', () => simulateIncomingCall());
  
  // ==========================================
  // ACUITY HANDLER - Lazy loaded
  // ==========================================
  ipcMain.handle('acuity:test', async () => {
    const acuityConfig = cachedSettings.acuity || {};
    if (!acuityConfig?.enabled) {
      return { success: false, message: 'Acuity Scheduler is disabled' };
    }
    try {
      const { testConnection } = getAcuityClient();
      return await testConnection();
    } catch (error) {
      return { success: false, message: 'Test failed', error: error.message };
    }
  });

  // ==========================================
  // WINDOW HANDLERS - Consolidated
  // ==========================================
  const windowHandler = (action) => {
    if (flyoutWindow?.window && !flyoutWindow.window.isDestroyed()) {
      if (action === 'minimize') flyoutWindow.window.minimize();
      else if (action === 'close') flyoutWindow.window.hide();
    }
    return true;
  };
  ipcMain.handle('window:minimize', () => windowHandler('minimize'));
  ipcMain.handle('window:close', () => windowHandler('close'));
  
  // ==========================================
  // EVENT LOG HANDLERS
  // ==========================================
  const eventLogger = require('./services/eventLogger');
  
  // Consolidate event handlers - use single handler with action parameter
  ipcMain.handle('events:query', (_event, action, ...args) => {
    switch (action) {
      case 'recent': return eventLogger.getRecentEvents(args[0], args[1]);
      case 'type': return eventLogger.getEventsByType(args[0]);
      case 'all': return eventLogger.getAllEvents(args[0]);
      case 'range': return eventLogger.getEventsInRange(args[0], args[1]);
      case 'path': return eventLogger.getEventLogFilePath();
      case 'delete': return eventLogger.deleteAllEvents();
      default: return [];
    }
  });

  // ==========================================
  // FIREWALL HANDLERS
  // ==========================================
  ipcMain.handle('firewall:check', async () => {
    try {
      return await checkFirewallStatus();
    } catch (error) {
      return { status: 'error', error: error.message };
    }
  });
  
  ipcMain.handle('firewall:instructions', () => getFirewallInstructions());

  // ==========================================
  // CLIPBOARD HANDLER
  // ==========================================
  ipcMain.handle('clipboard:write', (_event, text) => {
    if (text && typeof text === 'string') {
      clipboard.writeText(text);
      return true;
    }
    return false;
  });

  // ==========================================
  // UPDATE HANDLERS - Consolidated single handler
  // ==========================================
  ipcMain.handle('updates:action', (_event, action) => {
    if (!updateService) return { error: 'Update service not initialized' };
    
    switch (action) {
      case 'check':
        try { return updateService.checkForUpdates(true); } 
        catch (error) { return { error: error.message }; }
      case 'checkGithub':
        try { return updateService.checkForUpdatesWithGitHub(); } 
        catch (error) { return { error: error.message }; }
      case 'download':
        try { return updateService.downloadUpdate(); } 
        catch (error) { return { error: error.message }; }
      case 'install':
        try { return updateService.installUpdate(); } 
        catch (error) { return { error: error.message }; }
      case 'status':
        return updateService.getStatus();
      default:
        return { error: 'Unknown action' };
    }
  });
};

// Helper function to wait for network connectivity
const waitForNetwork = async (maxWaitMs = 30000) => {
  const dns = require('dns').promises;
  const startTime = Date.now();
  
  logger.info('🌐 Checking network connectivity...');
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Try to resolve a common DNS name to verify network is up
      await Promise.race([
        dns.lookup('google.com'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 2000))
      ]);
      logger.info('✅ Network connectivity confirmed');
      return true;
    } catch (error) {
      // Network not ready yet, wait a bit
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  logger.warn('⚠️ Network connectivity check timed out, proceeding anyway...');
  return false;
};

// Helper function to restart SIP connection safely
const restartSipConnection = async () => {
  if (!sipManager) {
    logger.warn('⚠️ Cannot restart SIP: manager not initialized');
    return;
  }
  
  try {
    logger.info('🔄 Restarting SIP connection...');
    await sipManager.stop();
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
    
    // Wait for network before restarting
    await waitForNetwork(10000);
    
    await sipManager.start();
    latestSipStatus = { state: sipManager.getState(), timestamp: new Date().toISOString() };
    flyoutWindow?.send('sip:status', latestSipStatus);
    logger.info('✅ SIP connection restarted successfully');
  } catch (error) {
    logger.error(`❌ Failed to restart SIP connection: ${error.message}`);
    logger.error(error.stack);
  }
};

const boot = async () => {
  // Initialize notification window first and wait for it to be ready
  notificationWindow = new NotificationWindow();
  
  // Wait for notification window to be ready before proceeding
  await new Promise((resolve) => {
    if (notificationWindow.isReady) {
      resolve();
    } else {
      // Wait for window to finish loading
      const checkReady = setInterval(() => {
        if (notificationWindow.isReady || !notificationWindow.window?.webContents?.isLoading()) {
          clearInterval(checkReady);
          // Give it a moment to fully initialize
          setTimeout(() => {
            if (!notificationWindow.isReady && !notificationWindow.window?.webContents?.isLoading()) {
              notificationWindow.isReady = true;
            }
            resolve();
          }, 500);
        }
      }, 100);
      
      // Timeout after 5 seconds
      setTimeout(() => {
        clearInterval(checkReady);
        resolve();
      }, 5000);
    }
  });
  
  logger.info('✅ Notification window ready');
  
  // Now initialize SIP manager and set up event listeners
  sipManager = new SipManager(cachedSettings.sip);
  flyoutWindow = new TrayWindow();

  // Set up event listener BEFORE starting SIP
  // Remove any existing listeners first to prevent duplicates
  sipManager.removeAllListeners('incomingCall');
  
  // Create a persistent handler function
  const incomingCallHandler = async (call) => {
    const { logIncomingCall, logToastDeployed, logToastTimeout } = require('./services/eventLogger');
    
    // Log incoming SIP call
    logIncomingCall({
      displayName: call.displayName,
      number: call.number,
      normalizedNumber: call.normalizedNumber,
      timestamp: call.timestamp
    });
    
    logger.info(`📞 Incoming SIP call received from ${call.displayName} (${call.number})`);
    logger.info(`🔍 Performing lookups for phone number: ${call.normalizedNumber}`);
    
    // Use cached settings
    const acuityConfig = cachedSettings.acuity || {};
    const hasAcuity = acuityConfig?.enabled && acuityConfig?.userId && acuityConfig?.apiKey;
    
    // Perform Acuity lookup
    let acuity;
    if (hasAcuity) {
      const { lookupClientByPhone } = getAcuityClient();
      acuity = await lookupClientByPhone(call.normalizedNumber);
    } else {
      acuity = { found: false, clientName: null, appointmentTime: null };
    }
    
    if (acuity.found) {
      logger.info(`✅ Acuity lookup found: ${acuity.clientName} - Next appointment: ${acuity.appointmentTime || 'N/A'}`);
    } else {
      logger.info('❌ Acuity lookup: No client match found');
    }
    
    logger.info('🔔 Showing toast notification');
    
    const toastPayload = {
      callerLabel: call.displayName || call.number,
      phoneNumber: call.number,
      clientName: acuity.found ? acuity.clientName : null,
      appointmentTime: acuity.appointmentTime,
      lookupState: acuity.found ? 'match' : 'unknown',
      acuityConfigured: hasAcuity, // Indicate if Acuity API is configured
      timestamp: call.timestamp
    };
    
    // Log toast deployment
    logToastDeployed(toastPayload);
    
    notificationWindow.show(toastPayload);
  };
  
  // Register the handler
  sipManager.on('incomingCall', incomingCallHandler);
  
  // Log that we've registered the handler
  logger.info(`✅ Registered incomingCall handler (listeners: ${sipManager.listenerCount('incomingCall')})`);
  
  // Set up a periodic check to ensure the handler is still registered
  const handlerCheckInterval = setInterval(() => {
    const count = sipManager.listenerCount('incomingCall');
    if (count === 0 && sipManager.getState() === 'registered') {
      logger.error(`❌ CRITICAL: incomingCall handler was lost! Re-registering...`);
      sipManager.on('incomingCall', incomingCallHandler);
      logger.info(`✅ Re-registered incomingCall handler`);
    }
  }, 5000); // Check every 5 seconds
  
  // Store interval reference for cleanup
  if (!global.sipHandlerCheckIntervals) {
    global.sipHandlerCheckIntervals = [];
  }
  global.sipHandlerCheckIntervals.push(handlerCheckInterval);

  // Remove any existing status listeners first
  sipManager.removeAllListeners('status');
  sipManager.on('status', (status) => {
    latestSipStatus = status;
    flyoutWindow?.send('sip:status', status);
    // Log status changes
    if (status.state === 'registered') {
      logger.info('SIP status: Registered and ready to receive calls');
      logger.info(`   Event listeners - incomingCall: ${sipManager.listenerCount('incomingCall')}, status: ${sipManager.listenerCount('status')}`);
    } else if (status.state === 'registering') {
      logger.info('SIP status: Registering with server...');
    } else if (status.state === 'disconnected') {
      logger.warn('SIP status: Disconnected from server');
    } else if (status.state === 'error') {
      logger.error(`SIP status: Error - ${status.meta?.cause || 'Unknown error'}`);
    }
  });

  // Start SIP connection after ensuring everything is initialized
  // Wait for network to be ready (especially important on system startup)
  await waitForNetwork();
  
  // Wait a moment to ensure all event listeners are properly registered and notification window is ready
  await new Promise(resolve => setTimeout(resolve, 1500));
  
  logger.info('🚀 Starting SIP connection...');
  await sipManager.start();
  latestSipStatus = { state: sipManager.getState(), timestamp: new Date().toISOString() };
  flyoutWindow?.send('sip:status', latestSipStatus);
  logger.info('✅ SIP manager started and ready to receive calls');
  
  // Set up periodic health check to detect if SIP stack becomes inactive
  const healthCheckInterval = setInterval(() => {
    if (sipManager) {
      const health = sipManager.checkHealth();
      if (!health.healthy && health.state === 'registered') {
        logger.error(`❌ SIP health check failed: ${health.issue || 'Unknown issue'}`);
        logger.error(`   State: ${health.state}, Stack: ${health.sipStackActive}, Handler: ${health.callbackHandlerExists}`);
        logger.info('🔄 Attempting to restart SIP connection...');
        // Use the restart helper function
        restartSipConnection();
      } else if (health.healthy) {
        logger.debug(`✅ SIP health check passed (state: ${health.state})`);
      }
    }
  }, 30000); // Check every 30 seconds
  
  // Store interval for cleanup
  if (!global.sipHealthCheckIntervals) {
    global.sipHealthCheckIntervals = [];
  }
  global.sipHealthCheckIntervals.push(healthCheckInterval);
};

// Handle system sleep/wake events
if (powerMonitor) {
  powerMonitor.on('suspend', () => {
    logger.info('💤 System going to sleep - SIP connection will be lost');
    if (sipManager) {
      // Don't stop the stack, but mark that we're suspending
      logger.info('   SIP stack will need to reconnect on wake');
    }
  });

  powerMonitor.on('resume', async () => {
    logger.info('🌅 System resuming from sleep');
    logger.info('   Waiting for network connectivity...');
    
    // Wait for network to be ready
    await waitForNetwork(15000);
    
    // Restart SIP connection after wake
    if (sipManager && sipManager.getState() !== 'idle') {
      logger.info('🔄 Reconnecting SIP after system wake...');
      await restartSipConnection();
    }
  });

  powerMonitor.on('shutdown', () => {
    logger.info('🛑 System shutting down');
    if (sipManager) {
      sipManager.stop();
    }
  });

  powerMonitor.on('lock-screen', () => {
    logger.debug('🔒 Screen locked');
  });

  powerMonitor.on('unlock-screen', () => {
    logger.debug('🔓 Screen unlocked');
  });
} else {
  logger.warn('⚠️ powerMonitor not available on this platform');
}

app.whenReady().then(async () => {
  logger.info('🚀 SIP Toast application starting');
  logger.info('📦 Initializing components...');
  createTray();
  logger.info('✅ System tray icon created');
  wireIpc();
  logger.info('✅ IPC handlers registered');
  
  // Initialize update service
  updateService = new UpdateService();
  updateService.startAutoCheck();
  logger.info('✅ Update service initialized');
  
  // Reload events from file after app is ready (ensures log directory is properly resolved)
  const eventLogger = require('./services/eventLogger');
  eventLogger.reloadEvents();
  logger.info('✅ Event logs loaded from persistent storage');
  
  await boot();
  logger.info('✅ SIP manager and notification window initialized');
  applyAutoLaunch();
  logger.info('✅ Auto-launch settings applied');
  logger.info('✨ SIP Toast ready');

  app.on('activate', () => {
    // No foreground UI – keep minimized to tray.
  });
});

// Handle window-all-closed - don't quit on Windows when all windows are closed
// since we're running in the system tray
app.on('window-all-closed', () => {
  // On Windows, keep the app running in the tray
  if (process.platform !== 'darwin') {
    // Don't quit - app runs in system tray
  }
});

app.on('second-instance', () => {
  // Bring toast window forward on re-launch attempts.
  if (notificationWindow?.window) {
    notificationWindow.window.showInactive();
  }
});

app.on('before-quit', (event) => {
  // Allow quit to proceed - cleanup resources
  if (notificationWindow) {
    notificationWindow.destroy();
    notificationWindow = null;
  }
  if (sipManager) {
    sipManager.stop();
    sipManager = null;
  }
  if (flyoutWindow) {
    flyoutWindow.destroy();
    flyoutWindow = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on('will-quit', (event) => {
  // Final cleanup - ensure all resources are released
  if (notificationWindow) {
    notificationWindow.destroy();
    notificationWindow = null;
  }
  if (sipManager) {
    sipManager.stop();
    sipManager = null;
  }
  if (flyoutWindow) {
    flyoutWindow.destroy();
    flyoutWindow = null;
  }
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// Send all log entries to the renderer in real-time (with error handling to prevent memory leaks)
// Periodic memory cleanup (every 10 minutes)
const MEMORY_CLEANUP_INTERVAL = 10 * 60 * 1000;
let memoryCleanupInterval = setInterval(() => {
  // Force garbage collection hint (if available)
  if (global.gc) {
    global.gc();
  }
  // Clear any stale references
  if (cachedSettings && Object.keys(cachedSettings).length > 10) {
    // Rebuild cache to remove stale entries
    cachedSettings = settings.getAll();
  }
}, MEMORY_CLEANUP_INTERVAL);

// Cleanup on exit
app.on('before-quit', () => {
  if (memoryCleanupInterval) {
    clearInterval(memoryCleanupInterval);
    memoryCleanupInterval = null;
  }
  // Clean up SIP handler check intervals
  if (global.sipHandlerCheckIntervals) {
    global.sipHandlerCheckIntervals.forEach(interval => clearInterval(interval));
    global.sipHandlerCheckIntervals = [];
  }
  // Clean up SIP health check intervals
  if (global.sipHealthCheckIntervals) {
    global.sipHealthCheckIntervals.forEach(interval => clearInterval(interval));
    global.sipHealthCheckIntervals = [];
  }
});

// Track window visibility state for memory optimization
let isMainWindowVisible = false;
const { adjustLogBufferSize } = require('./services/logger');

// Update visibility state when window is shown/hidden
const updateWindowVisibility = (visible) => {
  isMainWindowVisible = visible;
  // Adjust log buffer size based on visibility (reduce when minimized)
  adjustLogBufferSize(!visible);
};

// Set up visibility tracking after flyoutWindow is created
setTimeout(() => {
  if (flyoutWindow?.window) {
    flyoutWindow.window.on('show', () => {
      updateWindowVisibility(true);
    });
    flyoutWindow.window.on('hide', () => {
      updateWindowVisibility(false);
    });
    // Set initial state
    updateWindowVisibility(flyoutWindow.window.isVisible());
  }
}, 100);

logEmitter.on('entry', (entry) => {
  // Memory optimization: Only send logs to renderer when window is visible
  // This reduces IPC overhead and renderer memory usage when minimized
  if (isMainWindowVisible && flyoutWindow && flyoutWindow.window && !flyoutWindow.window.isDestroyed()) {
    try {
      flyoutWindow.send('logs:entry', entry);
    } catch (error) {
      // Window might be closed, ignore to prevent memory leaks
    }
  }
  // Logs are still written to file, just not sent to renderer when hidden
});

