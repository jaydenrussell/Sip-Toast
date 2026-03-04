const { app, Tray, Menu, nativeImage, ipcMain, clipboard, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const dns = require('dns').promises;

// Handle Squirrel.Windows events (install, update, uninstall)
// This must be done before any other initialization
const { handleSquirrelEvent, checkForSquirrelEvent } = require('./squirrelEvents');
const squirrelCmd = checkForSquirrelEvent();
if (squirrelCmd && handleSquirrelEvent(squirrelCmd)) {
  // Squirrel event was handled, app will exit
} else if (require('electron-squirrel-startup')) {
  app.quit();
  process.exit(0);
}


// Lazy-loaded modules with memory optimization
let _acuityClient, _eventLogger;
const getAcuityClient = () => {
  if (!_acuityClient) {
    // Only load when needed to save memory
    _acuityClient = require('./services/acuityClient');
  }
  return _acuityClient;
};
const getEventLogger = () => {
  if (!_eventLogger) {
    // Only load when needed to save memory
    _eventLogger = require('./services/eventLogger');
  }
  return _eventLogger;
};

// Core modules
const SipManager = require('./sip/sipManager');
const NotificationWindow = require('./notification/notificationWindow');
const TrayWindow = require('./tray/trayWindow');
const UpdateService = require('./services/updateService');
const { logger, logEmitter, getRecentLogs, adjustLogBufferSize } = require('./services/logger');
const { checkFirewallStatus, getFirewallInstructions } = require('./services/firewallChecker');
const settings = require('./settings');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let tray, notificationWindow, sipManager, flyoutWindow, updateService = null;
let latestSipStatus = { state: 'idle', timestamp: new Date().toISOString() };
let isMainWindowVisible = false, isAppQuitting = false;

// Performance: Cache resolved icon path
let cachedIconPath = null;

// Cache settings to avoid repeated lookups (memory-optimized)
let cachedSettings = settings.getAll();
// Use individual listeners for each section (electron-store doesn't have onDidChangeAny)
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
  
  const acuity = acuityResult;
  
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
  
  try {
    // Ensure notificationWindow exists
    if (!notificationWindow) {
      logger.error('❌ Notification window not initialized');
      throw new Error('Notification window not initialized');
    }
    
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
    
    logger.info('✅ Test toast notification shown successfully');
    return true;
  } catch (error) {
    logger.error(`❌ Failed to show test toast notification: ${error.message}`);
    logger.error(error.stack);
    throw error;
  }
};

const resolveIconPath = () => {
  // Return cached path if available
  if (cachedIconPath) return cachedIconPath;
  
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
        cachedIconPath = iconPath;
        return iconPath;
      }
    }
    
    // If not found, return the most likely path (extraResources location)
    cachedIconPath = path.join(process.resourcesPath, 'Images', 'app.ico');
    return cachedIconPath;
  } else {
    // In development, use the project Images folder
    cachedIconPath = path.join(__dirname, '..', '..', 'Images', 'app.ico');
    return cachedIconPath;
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

// Create a download/update icon with an arrow indicator
const createDownloadIcon = () => {
  const size = 16;
  // Create a simple icon with a download arrow indicator
  // Using a blue base with green arrow
  const pixelData = Buffer.alloc(size * size * 4);
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      
      // Create a rounded square base (blue)
      const inBounds = x >= 1 && x < 15 && y >= 1 && y < 15;
      
      if (inBounds) {
        // Base blue color
        pixelData[idx] = 37;     // R
        pixelData[idx + 1] = 99;  // G  
        pixelData[idx + 2] = 235; // B
        pixelData[idx + 3] = 255; // A
        
        // Add green arrow in center (downward pointing)
        const centerX = 7 + Math.floor(x / 4);
        const centerY = 7 + Math.floor(y / 4);
        
        // Simple arrow shape
        if (y >= 6 && y <= 10 && x >= 5 && x <= 10) {
          // Arrow shaft and head
          if (y === 10 && x >= 6 && x <= 9) {
            // Arrow head bottom
            pixelData[idx] = 16;     // R - green
            pixelData[idx + 1] = 185; // G
            pixelData[idx + 2] = 88;  // B
          } else if (y >= 6 && y <= 9 && x >= 7 && x <= 8) {
            // Arrow shaft
            pixelData[idx] = 16;     // R - green
            pixelData[idx + 1] = 185; // G
            pixelData[idx + 2] = 88;  // B
          } else if (y === 6 && x >= 5 && x <= 10) {
            // Arrow head top
            pixelData[idx] = 16;     // R - green
            pixelData[idx + 1] = 185; // G
            pixelData[idx + 2] = 88;  // B
          }
        }
      } else {
        // Transparent outside
        pixelData[idx] = 0;
        pixelData[idx + 1] = 0;
        pixelData[idx + 2] = 0;
        pixelData[idx + 3] = 0;
      }
    }
  }
  
  const icon = nativeImage.createFromBuffer(pixelData, { width: size, height: size });
  if (process.platform === 'win32') {
    icon.setTemplateImage(false);
  }
  return icon;
};

// Store the original icon for switching back
let originalTrayIcon = null;
let cachedDownloadIcon = null; // Cache download icon to avoid recreating
let cachedTrayIcon = null; // Cache main tray icon

// Cached tray icon - create once and reuse
const getTrayIcon = () => {
  if (!cachedTrayIcon) {
    cachedTrayIcon = createTrayIcon();
  }
  return cachedTrayIcon;
};

// Update tray icon based on update status (Discord-style)
const updateTrayIcon = (status) => {
  try {
    if (!tray || !tray.getImage) return;
    
    // On first call, store the original icon
    if (!originalTrayIcon) {
      try {
        originalTrayIcon = tray.getImage();
      } catch (e) {
        return;
      }
    }
    
    // Only show download icon when update is DOWNLOADED and ready (Discord-style)
    if (status.updateDownloaded) {
      // Update ready - show download icon (cached)
      if (!cachedDownloadIcon) {
        cachedDownloadIcon = createDownloadIcon();
      }
      tray.setImage(cachedDownloadIcon);
      tray.setToolTip('SIP Caller ID - Update ready to install');
    } else if (status.downloading) {
      // Downloading - show progress in tooltip
      tray.setToolTip(`SIP Caller ID - Updating ${status.downloadProgress}%`);
    } else if (!status.checking) {
      // No update - restore original icon
      if (originalTrayIcon && !originalTrayIcon.isEmpty()) {
        tray.setImage(originalTrayIcon);
      }
      tray.setToolTip('SIP Caller ID');
    }
  } catch (error) {
    // Tray might have been destroyed during shutdown, ignore silently
  }
};

const createTray = () => {
  if (tray) return tray;
  const icon = createTrayIcon();
  tray = new Tray(icon);

  // Build dynamic context menu that includes update status
  const buildContextMenu = () => {
    const updateStatus = updateService?.getStatus() || {};
    const updateItems = [];
    
    if (updateStatus.updateDownloaded) {
      updateItems.push({
        label: `Install Update v${updateStatus.availableVersion}`,
        click: () => {
          if (updateService) {
            updateService.quitAndInstall();
          }
        }
      });
    } else if (updateStatus.checking) {
      updateItems.push({
        label: 'Checking for updates...',
        enabled: false
      });
    } else {
      updateItems.push({
        label: 'Check for Updates',
        click: async () => {
          if (updateService) {
            await updateService.checkForUpdates();
          }
        }
      });
    }
    
    return Menu.buildFromTemplate([
      {
        label: 'Open Control Center',
        click: () => flyoutWindow?.showStandalone()
      },
      ...updateItems,
      { type: 'separator' },
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
  };
  
  // Update context menu whenever it would be shown
  const contextMenu = buildContextMenu();

  tray.setToolTip('SIP Caller ID');
  // Update context menu dynamically when shown
  tray.setContextMenu(buildContextMenu());
  tray.on('context-menu', () => {
    tray.setContextMenu(buildContextMenu());
  });
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

const wireIpc = () => {
  ipcMain.handle('app:info', () => {
    const appName = app.getName() || 'SIP Caller ID';
    // Use app.getVersion() which works in both dev and production
    const version = app.getVersion() || 'Unknown';
    
    // Get build date from package.json (set during build process)
    let buildDate = 'Unknown';
    let packageJson = null;
    
    try {
      // Use app.getAppPath() which works in both dev and production
      const appPath = app.getAppPath();
      const packageJsonPath = path.join(appPath, 'package.json');
      
      if (fs.existsSync(packageJsonPath)) {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      } else {
        // Fallback: try require (works in dev mode)
        try {
          packageJson = require('../package.json');
        } catch (e) {
          logger.warn(`Could not load package.json: ${e.message}`);
        }
      }
      
      if (packageJson?.buildDate) {
        const buildDateObj = new Date(packageJson.buildDate);
        if (!isNaN(buildDateObj.getTime())) {
          buildDate = buildDateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          });
        }
      }
      
      // Log for debugging if still unknown
      if (buildDate === 'Unknown') {
        logger.warn(`Build date not found. App path: ${appPath}, Package.json exists: ${packageJson !== null}`);
      }
    } catch (error) {
      logger.warn(`Could not determine build date: ${error.message}`);
    }
    
    return {
      appName,
      version,
      buildDate
    };
  });

  ipcMain.handle('settings:get', (_event, key) => settings.get(key));
  ipcMain.handle('settings:getAll', () => cachedSettings); // Return cached settings
  ipcMain.handle('settings:save', (_event, payload) => {
    const saved = settings.save(payload || {});
    cachedSettings = settings.getAll();
    
    if (payload.sip) {
      logger.info(`💾 SIP: ${saved.sip?.server}:${saved.sip?.port || 5060} (${(saved.sip?.transport || 'udp').toUpperCase()})`);
      sipManager?.updateConfig(saved.sip).catch(e => logger.error(`SIP update failed: ${e.message}`));
    }
    if (payload.acuity) logger.info(`💾 Acuity: ${saved.acuity?.userId || 'N/A'}`);
    if (payload.callerId) logger.info(`💾 CallerID: ${saved.callerId?.enabled ? 'on' : 'off'}`);
    if (payload.app) { applyAutoLaunch(); logger.info(`💾 Auto-launch: ${saved.app?.launchAtLogin ? 'on' : 'off'}`); }
    if (payload.toast) logger.info(`💾 Toast timeout: ${(saved.toast?.autoDismissMs || 20000) / 1000}s`);
    if (payload.updates) { logger.info(`💾 Updates: ${saved.updates?.enabled ? 'on' : 'off'}`); updateService?.restartAutoCheck(); }
    
    return saved;
  });

  ipcMain.handle('logs:tail', (_event, count) => getRecentLogs(count));

  ipcMain.handle('sip:restart', async () => {
    logger.info('🔄 SIP restart requested by user');
    if (sipManager) {
      const success = await sipManager.restart();
      logger.info(`✅ SIP restart ${success ? 'successful' : 'failed'}`);
      return success;
    }
    return false;
  });

  ipcMain.handle('acuity:test', async () => {
    logger.info('🧪 Acuity API connection test requested');
    const acuityConfig = cachedSettings.acuity || {};
    if (!acuityConfig?.enabled) {
      return {
        success: false,
        message: 'Acuity Scheduler is disabled',
        error: 'Enable Acuity Scheduler in settings to test connection'
      };
    }
    try {
      const { testConnection } = getAcuityClient();
      const result = await testConnection();
      return result;
    } catch (error) {
      logger.error(`❌ Acuity test error: ${error.message}`);
      return {
        success: false,
        message: 'Test failed',
        error: error.message
      };
    }
  });


  ipcMain.handle('sip:test', async () => {
    logger.info('🔍 SIP connection test requested');
    const sipConfig = cachedSettings.sip;
    
    if (!sipConfig || !sipConfig.server || !sipConfig.username || !sipConfig.password) {
      return {
        success: false,
        message: 'SIP settings incomplete',
        error: 'Missing required fields: Server, Username, or Password',
        status: 'Incomplete',
        server: sipConfig?.server || 'Not set',
        port: sipConfig?.port || 5060,
        transport: sipConfig?.transport || 'udp',
        dns: 'Not tested',
        ip: 'Not tested',
        username: sipConfig?.username || 'Not set',
        uri: sipConfig?.uri || 'Not set'
      };
    }

    try {
      // Test DNS resolution and get IP
      const dns = require('dns').promises;
      const serverHost = sipConfig.server.split(':')[0].replace(/^sips?:\/\//, '').replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').split('/')[0];
      let dnsResult = 'Failed';
      let ipAddress = 'Unknown';
      
      try {
        const addresses = await Promise.race([
          dns.lookup(serverHost, { all: true }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('DNS timeout after 3 seconds')), 3000))
        ]);
        
        if (addresses && addresses.length > 0) {
          dnsResult = 'Success';
          ipAddress = addresses.map(addr => addr.address).join(', ');
          logger.info(`✅ DNS lookup successful: ${serverHost} → ${ipAddress}`);
        }
      } catch (dnsError) {
        dnsResult = `Failed: ${dnsError.message}`;
        logger.error(`❌ DNS lookup failed for ${serverHost}: ${dnsError.message}`);
        return {
          success: false,
          message: 'DNS lookup failed',
          error: `Cannot resolve ${serverHost}: ${dnsError.message}`,
          status: 'DNS Error',
          server: sipConfig.server,
          port: sipConfig.port || 5060,
          transport: sipConfig.transport || 'udp',
          dns: dnsResult,
          ip: ipAddress,
          username: sipConfig.username,
          uri: sipConfig.uri || (() => {
            const domain = sipConfig.domain || serverHost;
            const scheme = sipConfig.transport === 'tls' ? 'sips' : 'sip';
            return `${scheme}:${sipConfig.username}@${domain}`;
          })()
        };
      }

      // Determine domain (use provided domain or server hostname)
      const domain = sipConfig.domain || serverHost;
      const transport = sipConfig.transport || 'udp';
      const scheme = transport === 'tls' ? 'sips' : 'sip';
      const sipUri = sipConfig.uri || `${scheme}:${sipConfig.username}@${domain}`;

      // Check current SIP status
      const currentState = sipManager?.getState() || 'idle';
      
      return {
        success: currentState === 'registered',
        message: currentState === 'registered' 
          ? 'SIP connection is active and registered' 
          : `SIP status: ${currentState}`,
        error: currentState === 'error' ? latestSipStatus?.meta?.cause : null,
        status: currentState.charAt(0).toUpperCase() + currentState.slice(1),
        server: sipConfig.server,
        port: sipConfig.port || 5060,
        transport: transport,
        dns: dnsResult,
        ip: ipAddress,
        username: sipConfig.username,
        uri: sipUri
      };
    } catch (error) {
      return {
        success: false,
        message: 'Test failed',
        error: error.message,
        status: 'Error',
        server: sipConfig?.server || 'Not set',
        port: sipConfig?.port || 5060,
        transport: sipConfig?.transport || 'udp',
        dns: 'Not tested',
        ip: 'Not tested',
        username: sipConfig?.username || 'Not set',
        uri: sipConfig?.uri || 'Not set'
      };
    }
  });

  ipcMain.handle('sip:status:get', () => latestSipStatus);
  ipcMain.handle('sip:health:check', () => {
    if (sipManager) {
      return sipManager.checkHealth();
    }
    return { healthy: false, issue: 'SIP manager not initialized' };
  });
  ipcMain.handle('sim:incoming', () => simulateIncomingCall());
  
  ipcMain.handle('window:minimize', () => {
    if (flyoutWindow?.window && !flyoutWindow.window.isDestroyed()) {
      flyoutWindow.window.minimize();
    }
    return true;
  });
  
  ipcMain.handle('window:close', () => {
    if (flyoutWindow?.window && !flyoutWindow.window.isDestroyed()) {
      flyoutWindow.window.hide();
    }
    return true;
  });
  
  ipcMain.handle('log:action', (_event, message) => {
    logger.info(message);
    return true;
  });

  // Event log handlers - lazy-loaded module
  ipcMain.handle('events:getRecent', (_e, count, filterType) => getEventLogger().getRecentEvents(count, filterType));
  ipcMain.handle('events:getByType', (_e, type) => getEventLogger().getEventsByType(type));
  ipcMain.handle('events:getAll', (_e, filterType) => getEventLogger().getAllEvents(filterType));
  ipcMain.handle('events:getInRange', (_e, start, end) => getEventLogger().getEventsInRange(start, end));
  ipcMain.handle('events:getLogFilePath', () => getEventLogger().getEventLogFilePath());
  ipcMain.handle('events:deleteAll', () => getEventLogger().deleteAllEvents());

  // Firewall check handlers
  ipcMain.handle('firewall:check', async () => {
    logger.info('🔥 Firewall status check requested');
    try {
      const status = await checkFirewallStatus();
      return status;
    } catch (error) {
      logger.error(`❌ Firewall check failed: ${error.message}`);
      return {
        status: 'error',
        error: error.message,
        recommendations: [{
          type: 'error',
          message: `Firewall check failed: ${error.message}`,
          action: 'Check Windows Firewall settings manually.'
        }]
      };
    }
  });

  ipcMain.handle('firewall:instructions', () => {
    return getFirewallInstructions();
  });

  ipcMain.handle('clipboard:write', (_event, text) => {
    try {
      if (!text || typeof text !== 'string') {
        logger.warn('Invalid text provided to clipboard:write');
        return false;
      }
      clipboard.writeText(text);
      logger.info(`📋 Copied to clipboard: ${text}`);
      return true;
    } catch (error) {
      logger.error(`❌ Failed to copy to clipboard: ${error.message}`);
      return false;
    }
  });

// Update handlers - Squirrel.Windows auto-update
  ipcMain.handle('updates:check', async () => {
    if (!updateService) {
      return { error: 'Update service not initialized' };
    }
    try {
      return await updateService.checkForUpdates();
    } catch (error) {
      logger.error(`Update check failed: ${error.message}`);
      return { error: error.message };
    }
  });

  ipcMain.handle('updates:status', () => {
    if (!updateService) {
      return { error: 'Update service not initialized' };
    }
    return updateService.getStatus();
  });

  ipcMain.handle('updates:quitAndInstall', async () => {
    if (!updateService) {
      return { error: 'Update service not initialized' };
    }
    return await updateService.quitAndInstall();
  });
};

// Helper function to wait for network connectivity
const waitForNetwork = async (maxWaitMs = 30000) => {
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
  // flyoutWindow is already created in app.whenReady() before createTray() is called

  // Set up event listener BEFORE starting SIP
  // Remove any existing listeners first to prevent duplicates
  sipManager.removeAllListeners('incomingCall');

  // Create a persistent handler function
  const incomingCallHandler = async (call) => {
    const { logIncomingCall, logToastDeployed } = getEventLogger();

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

    // Ensure notificationWindow exists before showing
    if (!notificationWindow || !notificationWindow.window || notificationWindow.window.isDestroyed()) {
      logger.error('❌ Notification window not initialized, cannot show toast');
      return;
    }

    notificationWindow.show(toastPayload);
  };

  // Register the handler
  sipManager.on('incomingCall', incomingCallHandler);

  // Log that we've registered the handler
  logger.info(`✅ Registered incomingCall handler (listeners: ${sipManager.listenerCount('incomingCall')})`);

  // Set up a periodic check to ensure the handler is still registered (every 30s for memory efficiency)
  const handlerCheckInterval = setInterval(() => {
    if (!sipManager) return;
    const count = sipManager.listenerCount('incomingCall');
    if (count === 0 && sipManager.getState() === 'registered') {
      logger.error(`❌ CRITICAL: incomingCall handler was lost! Re-registering...`);
      sipManager.on('incomingCall', incomingCallHandler);
      logger.info(`✅ Re-registered incomingCall handler`);
    }
  }, 30000);

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
  logger.info('🚀 SIP Caller ID application starting');
  logger.info('📦 Initializing components...');

  // Set Windows app user model ID for proper taskbar behavior
  app.setAppUserModelId('com.siptoast.app');

  // Check for and migrate settings from previous installations
  logger.info('🔄 Checking for previous installation settings...');
  const migrated = settings.checkAndMigrate();
  if (migrated) {
    logger.info('✅ Settings migrated from previous installation');
    // Refresh cached settings after migration
    cachedSettings = settings.getAll();
  } else {
    logger.info('ℹ️  No previous installation settings found or migration not needed');
  }

  // Initialize flyoutWindow BEFORE creating tray
  // This ensures flyoutWindow exists when tray click handler runs
  flyoutWindow = new TrayWindow();
  logger.info('✅ Control center window created');

  createTray();
  logger.info('✅ System tray icon created');
  wireIpc();
  logger.info('✅ IPC handlers registered');

  // Initialize update service
  updateService = new UpdateService();

  // Set up update status event listener to update tray icon and send to renderer
  // Wrap entire handler in try-catch to prevent uncaught exceptions during update
  updateService.on('update-status', (status) => {
    // Early exit if app is shutting down
    if (isAppQuitting) return;

    try {
      updateTrayIcon(status);
    } catch (e) { /* Ignore tray errors during shutdown */ }

    // Send status to renderer (including when update is downloaded)
    try {
      // Check if window exists and is not destroyed before sending
      if (flyoutWindow && flyoutWindow.window && !flyoutWindow.window.isDestroyed()) {
        flyoutWindow.send('update:status', status);
      }
    } catch (e) { /* Ignore window errors during shutdown */ }
  });

  // Set isAppQuitting when install starts
  updateService.on('installing', () => { isAppQuitting = true; });

  // Start auto-check (this will also check on app load)
  updateService.startAutoCheck();
  logger.info('✅ Update service initialized');

  // Reload events from file after app is ready (ensures log directory is properly resolved)
  getEventLogger().reloadEvents();
  logger.info('✅ Event logs loaded from persistent storage');

  await boot();
  logger.info('✅ SIP manager and notification window initialized');
  applyAutoLaunch();
  logger.info('✅ Auto-launch settings applied');
  logger.info('✨ SIP Caller ID ready');

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
    sipManager.destroy(); // Use destroy() for complete cleanup
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
    sipManager.destroy(); // Use destroy() for complete cleanup
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

// Set up visibility tracking after flyoutWindow is created
setTimeout(() => {
  const win = flyoutWindow?.window;
  if (!win) return;
  const update = (v) => { isMainWindowVisible = v; adjustLogBufferSize(!v); };
  win.on('show', () => update(true));
  win.on('hide', () => update(false));
  update(win.isVisible());
}, 100);

// Log handler - early exit during shutdown to prevent "Object destroyed" errors
logEmitter.on('entry', (entry) => {
  if (isAppQuitting) return;
  if (isMainWindowVisible && flyoutWindow?.window && !flyoutWindow.window.isDestroyed()) {
    try { flyoutWindow.send('logs:entry', entry); } catch {}
  }
});
app.on('before-quit', () => { isAppQuitting = true; });

