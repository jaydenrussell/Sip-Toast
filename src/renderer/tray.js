const form = document.getElementById('settingsForm');
const saveStatus = document.getElementById('saveStatus');
const restartButton = document.getElementById('restartSip');
const simulateButton = document.getElementById('simulateCall');
const sipStatus = document.getElementById('sipStatus');
const autoLaunchToggle = document.getElementById('autoLaunchToggle');
const autoLaunchInput = form.querySelector('[name="app.launchAtLogin"]');
const sectionTitle = document.getElementById('sectionTitle');
const sectionSubtitle = document.getElementById('sectionSubtitle');

let currentSettings = null;

// Sidebar navigation
const navItems = document.querySelectorAll('.nav-item');
const sections = {
  sip: { title: 'SIP Provider', subtitle: 'Configure your SIP connection settings' },
  acuity: { title: 'Acuity Scheduler', subtitle: 'Configure API credentials for client lookups' },
  options: { title: 'Options', subtitle: 'Application settings and controls' },
  firewall: { title: 'Firewall', subtitle: 'Check Windows Firewall configuration' },
  logs: { title: 'Event Logs', subtitle: 'View SIP calls, toast notifications, and user interactions' },
  about: { title: 'About', subtitle: 'Application information' }
};

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const section = item.dataset.section;
    
    // Update active nav item
    navItems.forEach((nav) => nav.classList.remove('active'));
    item.classList.add('active');
    
    // Show/hide sections
    document.querySelectorAll('.content-section').forEach((sec) => {
      sec.classList.remove('active');
    });
    const targetSection = document.getElementById(`section-${section}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }
    
    // Update header
    if (sections[section]) {
      sectionTitle.textContent = sections[section].title;
      sectionSubtitle.textContent = sections[section].subtitle;
    }
    
    // Load event logs if logs section is shown
    if (section === 'logs') {
      loadEventLogs();
      loadLogFilePath();
    }
    
    // Load firewall status if firewall section is shown
    if (section === 'firewall') {
      // Don't auto-check, let user click the button
    }
    
    // Load update status if options section is shown
    if (section === 'options') {
      loadUpdateStatus();
    }
  });
});

// Cache field names split to avoid repeated string operations
const fieldNames = [
  'sip.server',
  'sip.port',
  'sip.transport',
  'sip.domain',
  'sip.username',
  'sip.password',
  'acuity.enabled',
  'acuity.userId',
  'acuity.apiKey',
  'toast.autoDismissMs',
  'toast.numberFont',
  'toast.numberFontSize',
  'toast.callerIdFont',
  'toast.callerIdFontSize',
  'updates.enabled',
  'updates.checkFrequency'
];

// Cache split results for field names (memory optimization)
const fieldNameCache = new Map();
const getFieldParts = (name) => {
  let parts = fieldNameCache.get(name);
  if (!parts) {
    parts = name.split('.');
    if (fieldNameCache.size < 50) { // Limit cache size
      fieldNameCache.set(name, parts);
    }
  }
  return parts;
};

const getInput = (name) => form.querySelector(`[name="${name}"]`);

const updateToggleVisual = (state) => {
  autoLaunchToggle.setAttribute('aria-checked', state ? 'true' : 'false');
  autoLaunchInput.value = state ? 'true' : 'false';
};

const renderSettings = (settings) => {
  fieldNames.forEach((name) => {
    const input = getInput(name);
    if (!input) return;
    
    // Use cached split result
    const parts = getFieldParts(name);
    const [section, key] = parts;
    let value = (settings[section] && settings[section][key]);
    
    // Set default value for port based on transport
    if (key === 'port' && !value) {
      const transportInput = form.querySelector('[name="sip.transport"]');
      const transport = transportInput ? transportInput.value : 'udp';
      value = transport === 'tls' ? 5061 : 5060;
    }
    
    // Set default transport if not set
    if (key === 'transport' && !value) {
      value = 'udp';
    }
    
    // Handle select elements - check if value exists in options
    if (input.tagName === 'SELECT' && value) {
      const optionExists = Array.from(input.options).some(opt => opt.value === value);
      if (!optionExists) {
        // Value doesn't exist in dropdown, use default
        if (key === 'numberFont' || key === 'callerIdFont') {
          value = 'Segoe UI Variable, Segoe UI, sans-serif';
        }
      }
    }
    
    input.value = value || '';
  });

  const launchAtLogin =
    (settings.app && typeof settings.app.launchAtLogin === 'boolean'
      ? settings.app.launchAtLogin
      : true);
  updateToggleVisual(launchAtLogin);
  
  // Handle Acuity enabled toggle
  const acuityEnabledToggle = document.getElementById('acuityEnabledToggle');
  if (acuityEnabledToggle) {
    const acuityEnabled = settings.acuity && typeof settings.acuity.enabled === 'boolean'
      ? settings.acuity.enabled
      : false;
    acuityEnabledToggle.setAttribute('aria-checked', acuityEnabled ? 'true' : 'false');
    const acuityEnabledInput = form.querySelector('[name="acuity.enabled"]');
    if (acuityEnabledInput) {
      acuityEnabledInput.value = acuityEnabled ? 'true' : 'false';
    }
  }

  // Handle Auto-update enabled toggle
  const autoUpdateToggle = document.getElementById('autoUpdateToggle');
  if (autoUpdateToggle) {
    const updatesEnabled = settings.updates && typeof settings.updates.enabled === 'boolean'
      ? settings.updates.enabled
      : true;
    autoUpdateToggle.setAttribute('aria-checked', updatesEnabled ? 'true' : 'false');
    const autoUpdateInput = form.querySelector('[name="updates.enabled"]');
    if (autoUpdateInput) {
      autoUpdateInput.value = updatesEnabled ? 'true' : 'false';
    }
  }

  // Handle update check frequency
  const updateFrequencySelect = document.getElementById('updateFrequencySelect');
  if (updateFrequencySelect && settings.updates) {
    updateFrequencySelect.value = settings.updates.checkFrequency || 'daily';
  }

};

const buildSipUri = (username, domain, server, transport) => {
  if (!username) return null;
  try {
    // Use domain if provided, otherwise fall back to server hostname
    const hostname = domain || (server ? server.replace(/^sips?:\/\//, '').replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').split(':')[0].split('/')[0] : null);
    if (!hostname) return null;
    // Use sips: for TLS, sip: for UDP/TCP
    const scheme = transport === 'tls' ? 'sips' : 'sip';
    return `${scheme}:${username}@${hostname}`;
  } catch (error) {
    return null;
  }
};

const collectPayload = () => {
  const payload = {
    sip: {},
    acuity: {},
    toast: {},
    app: {},
    updates: {}
  };

  fieldNames.forEach((name) => {
    const input = getInput(name);
    if (!input) return;
    
    // Use cached split result
    const parts = getFieldParts(name);
    const [section, key] = parts;
    let value = input.value.trim() || null;
    
    // Convert numeric fields
    if (key === 'port' || key === 'autoDismissMs' || key === 'numberFontSize' || key === 'callerIdFontSize') {
      value = value ? Number(value) : (key === 'port' ? 5060 : null);
    }
    
    payload[section][key] = value;
  });

  if (payload.toast.autoDismissMs) {
    payload.toast.autoDismissMs = Number(payload.toast.autoDismissMs);
  }
  
  if (payload.toast.numberFontSize) {
    payload.toast.numberFontSize = Number(payload.toast.numberFontSize);
  }
  
  if (payload.toast.callerIdFontSize) {
    payload.toast.callerIdFontSize = Number(payload.toast.callerIdFontSize);
  }

  // Ensure port has a default value
  if (!payload.sip.port) {
    payload.sip.port = 5060;
  }

  const launchAtLogin = autoLaunchToggle.getAttribute('aria-checked') === 'true';
  payload.app.launchAtLogin = launchAtLogin;
  
  // Handle Acuity enabled toggle
  const acuityEnabledToggle = document.getElementById('acuityEnabledToggle');
  if (acuityEnabledToggle) {
    const acuityEnabled = acuityEnabledToggle.getAttribute('aria-checked') === 'true';
    payload.acuity.enabled = acuityEnabled;
  }
  
  // Handle Auto-update enabled toggle
  const autoUpdateToggle = document.getElementById('autoUpdateToggle');
  if (autoUpdateToggle) {
    const updatesEnabled = autoUpdateToggle.getAttribute('aria-checked') === 'true';
    payload.updates.enabled = updatesEnabled;
  }
  
  // Handle update check frequency
  const updateFrequencySelect = document.getElementById('updateFrequencySelect');
  if (updateFrequencySelect) {
    payload.updates.checkFrequency = updateFrequencySelect.value || 'daily';
  }

  // Set default port based on transport
  if (!payload.sip.port) {
    payload.sip.port = payload.sip.transport === 'tls' ? 5061 : 5060;
  }

  // Build SIP URI from username, domain (or server as fallback)
  const computedUri = buildSipUri(payload.sip.username, payload.sip.domain, payload.sip.server, payload.sip.transport);
  if (computedUri) {
    payload.sip.uri = computedUri;
  } else if (currentSettings?.sip?.uri) {
    payload.sip.uri = currentSettings.sip.uri;
  }

  return payload;
};

const setSaveStatus = (message, tone = 'neutral') => {
  saveStatus.textContent = message;
  saveStatus.dataset.tone = tone;
  if (message) {
    setTimeout(() => {
      saveStatus.textContent = '';
      saveStatus.dataset.tone = 'neutral';
    }, 4000);
  }
};


const loadSettings = async () => {
  currentSettings = await window.trayAPI.getSettings();
  renderSettings(currentSettings);
};

const updateSipStatus = (status) => {
  if (!status) return;
  sipStatus.textContent = status.state.replace('-', ' ');
  sipStatus.dataset.state = status.state;
};

const saveSettings = async (section = 'all') => {
  setSaveStatus('Saving…');
  const payload = collectPayload();
  
  // If saving specific section, only include that section
  if (section === 'sip') {
    const sipPayload = { sip: payload.sip };
    const saved = await window.trayAPI.saveSettings(sipPayload);
    currentSettings = saved;
    setSaveStatus('SIP settings saved and connecting…', 'success');
    // Log the save action
    await window.trayAPI.logAction('SIP settings saved and connection initiated');
  } else if (section === 'acuity') {
    const acuityPayload = { acuity: payload.acuity };
    const saved = await window.trayAPI.saveSettings(acuityPayload);
    currentSettings = saved;
    setSaveStatus('Acuity settings saved', 'success');
    await window.trayAPI.logAction('Acuity settings saved');
  } else if (section === 'options') {
    const optionsPayload = { 
      toast: payload.toast,
      app: payload.app,
      updates: payload.updates
    };
    const saved = await window.trayAPI.saveSettings(optionsPayload);
    currentSettings = saved;
    setSaveStatus('Options saved', 'success');
    await window.trayAPI.logAction('Options saved');
  } else {
    const saved = await window.trayAPI.saveSettings(payload);
    currentSettings = saved;
    setSaveStatus('All settings saved', 'success');
    await window.trayAPI.logAction('All settings saved');
  }
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveSettings('all');
});

restartButton.addEventListener('click', async () => {
  setSaveStatus('Restarting SIP…');
  await window.trayAPI.restartSip();
  setSaveStatus('Restart signal sent', 'success');
  await window.trayAPI.logAction('SIP connection restarted');
});

// Save buttons
const saveSipBtn = document.getElementById('saveSipBtn');
const testSipBtn = document.getElementById('testSipBtn');
const saveAcuityBtn = document.getElementById('saveAcuityBtn');
const testAcuityBtn = document.getElementById('testAcuityBtn');
const saveOptionsBtn = document.getElementById('saveOptionsBtn');
const saveAllBtn = document.getElementById('saveAllBtn');
const sipDebugSection = document.getElementById('sipDebugSection');
const acuityDebugSection = document.getElementById('acuityDebugSection');
const toastTimeoutInput = document.getElementById('toastTimeoutInput');
const sipTransportSelect = document.getElementById('sipTransport');
const sipPortInput = form.querySelector('[name="sip.port"]');

// Update port when transport changes
if (sipTransportSelect && sipPortInput) {
  sipTransportSelect.addEventListener('change', (e) => {
    const transport = e.target.value;
    if (!sipPortInput.value || sipPortInput.value === '5060' || sipPortInput.value === '5061') {
      sipPortInput.value = transport === 'tls' ? 5061 : 5060;
    }
  });
}

if (saveSipBtn) {
  saveSipBtn.addEventListener('click', async () => {
    await saveSettings('sip');
  });
}

if (testSipBtn) {
  testSipBtn.addEventListener('click', async () => {
    setSaveStatus('Testing SIP connection...', 'neutral');
    try {
      const debugInfo = await window.trayAPI.testSipConnection();
      if (sipDebugSection) {
        sipDebugSection.style.display = 'block';
        document.getElementById('debugStatus').textContent = debugInfo.status || '-';
        document.getElementById('debugServer').textContent = debugInfo.server || '-';
        document.getElementById('debugPort').textContent = debugInfo.port || '-';
        document.getElementById('debugTransport').textContent = (debugInfo.transport || 'udp').toUpperCase();
        document.getElementById('debugDns').textContent = debugInfo.dns || '-';
        document.getElementById('debugIp').textContent = debugInfo.ip || '-';
        document.getElementById('debugUsername').textContent = debugInfo.username || '-';
        document.getElementById('debugUri').textContent = debugInfo.uri || '-';
        document.getElementById('debugError').textContent = debugInfo.error || 'None';
      }
      setSaveStatus(debugInfo.message || 'Connection test completed', debugInfo.success ? 'success' : 'error');
    } catch (error) {
      setSaveStatus(`Test failed: ${error.message}`, 'error');
    }
  });
}

if (saveAcuityBtn) {
  saveAcuityBtn.addEventListener('click', async () => {
    await saveSettings('acuity');
  });
}

if (saveOptionsBtn) {
  saveOptionsBtn.addEventListener('click', async () => {
    await saveSettings('options');
  });
}

// Auto-save toast timeout when value changes (with debounce)
if (toastTimeoutInput) {
  let timeoutDebounce;
  toastTimeoutInput.addEventListener('input', (e) => {
    clearTimeout(timeoutDebounce);
    const value = e.target.value;
    if (value && parseInt(value) >= 1000) {
      // Auto-save after 1 second of no changes
      timeoutDebounce = setTimeout(async () => {
        await saveSettings('options');
        setSaveStatus('Toast timeout saved', 'success');
      }, 1000);
    }
  });
  
  // Also save on blur (when user leaves the field)
  toastTimeoutInput.addEventListener('blur', async (e) => {
    clearTimeout(timeoutDebounce);
    const value = e.target.value;
    if (value && parseInt(value) >= 1000) {
      await saveSettings('options');
      setSaveStatus('Toast timeout saved', 'success');
    }
  });
}

if (testAcuityBtn) {
  testAcuityBtn.addEventListener('click', async () => {
    setSaveStatus('Testing Acuity API connection...', 'neutral');
    try {
      const testResult = await window.trayAPI.testAcuityConnection();
      if (acuityDebugSection) {
        acuityDebugSection.style.display = 'block';
        
        // Overall status
        document.getElementById('debugAcuityStatus').textContent = testResult.success ? 'Success' : 'Failed';
        document.getElementById('debugAcuityMessage').textContent = testResult.message || '-';
        document.getElementById('debugAcuityError').textContent = testResult.error || 'None';
        
        // Acuity API results
        if (testResult.acuity) {
          document.getElementById('debugAcuityApiStatus').textContent = testResult.acuity.success ? 'Success' : 'Failed';
          document.getElementById('debugAcuityApiMessage').textContent = testResult.acuity.message || '-';
          document.getElementById('debugAcuityApiError').textContent = testResult.acuity.error || 'None';
        } else {
          document.getElementById('debugAcuityApiStatus').textContent = 'Not tested';
          document.getElementById('debugAcuityApiMessage').textContent = 'Not configured';
          document.getElementById('debugAcuityApiError').textContent = '-';
        }
        
      }
      setSaveStatus(testResult.message || 'Connection test completed', testResult.success ? 'success' : 'error');
    } catch (error) {
      if (acuityDebugSection) {
        acuityDebugSection.style.display = 'block';
        document.getElementById('debugAcuityStatus').textContent = 'Error';
        document.getElementById('debugAcuityMessage').textContent = 'Test failed';
        document.getElementById('debugAcuityError').textContent = error.message || 'Unknown error';
        document.getElementById('debugAcuityApiStatus').textContent = 'Error';
        document.getElementById('debugAcuityApiMessage').textContent = 'Test failed';
        document.getElementById('debugAcuityApiError').textContent = error.message || 'Unknown error';
      }
      setSaveStatus(`Test failed: ${error.message}`, 'error');
    }
  });
}

// Acuity enabled toggle handler
if (acuityEnabledToggle) {
  const acuityEnabledInput = form.querySelector('[name="acuity.enabled"]');
  acuityEnabledToggle.addEventListener('click', () => {
    const current = acuityEnabledToggle.getAttribute('aria-checked') === 'true';
    const newState = !current;
    acuityEnabledToggle.setAttribute('aria-checked', newState ? 'true' : 'false');
    if (acuityEnabledInput) {
      acuityEnabledInput.value = newState ? 'true' : 'false';
    }
  });
}

// Auto-update enabled toggle handler
const autoUpdateToggle = document.getElementById('autoUpdateToggle');
if (autoUpdateToggle) {
  const autoUpdateInput = form.querySelector('[name="updates.enabled"]');
  autoUpdateToggle.addEventListener('click', () => {
    const current = autoUpdateToggle.getAttribute('aria-checked') === 'true';
    const newState = !current;
    autoUpdateToggle.setAttribute('aria-checked', newState ? 'true' : 'false');
    if (autoUpdateInput) {
      autoUpdateInput.value = newState ? 'true' : 'false';
    }
  });
}

// Update status display elements
const updateStatusContainer = document.getElementById('updateStatusContainer');
const updateStatusText = document.getElementById('updateStatusText');
const updateStatusActions = document.getElementById('updateStatusActions');
const checkUpdatesBtn = document.getElementById('checkUpdatesBtn');
const downloadUpdateBtn = document.getElementById('downloadUpdateBtn');
const installUpdateBtn = document.getElementById('installUpdateBtn');

// Function to update status display
const updateStatusDisplay = (status) => {
  if (!updateStatusContainer || !updateStatusText) return;
  
  if (status.checking) {
    updateStatusContainer.style.display = 'block';
    updateStatusText.textContent = 'Checking for updates...';
    updateStatusText.style.color = 'var(--text-primary)';
    updateStatusActions.style.display = 'none';
    if (checkUpdatesBtn) checkUpdatesBtn.disabled = true;
  } else if (status.error) {
    updateStatusContainer.style.display = 'block';
    updateStatusText.textContent = `Error: ${status.error}`;
    updateStatusText.style.color = '#ef4444';
    updateStatusActions.style.display = 'none';
    if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
  } else if (status.updateAvailable) {
    updateStatusContainer.style.display = 'block';
    updateStatusText.textContent = `Update available: Version ${status.version || 'Unknown'}`;
    updateStatusText.style.color = '#10b981';
    updateStatusActions.style.display = 'block';
    if (downloadUpdateBtn) downloadUpdateBtn.style.display = 'inline-block';
    if (installUpdateBtn) installUpdateBtn.style.display = 'none';
    if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
  } else if (status.updateDownloaded) {
    updateStatusContainer.style.display = 'block';
    updateStatusText.textContent = 'Update downloaded and ready to install';
    updateStatusText.style.color = '#10b981';
    updateStatusActions.style.display = 'block';
    if (downloadUpdateBtn) downloadUpdateBtn.style.display = 'none';
    if (installUpdateBtn) installUpdateBtn.style.display = 'inline-block';
    if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
  } else {
    updateStatusContainer.style.display = 'block';
    updateStatusText.textContent = `No updates available. Current version: ${status.currentVersion || 'Unknown'}`;
    updateStatusText.style.color = 'var(--text-muted)';
    updateStatusActions.style.display = 'none';
    if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
  }
};

// Check for updates button handler
if (checkUpdatesBtn) {
  checkUpdatesBtn.addEventListener('click', async () => {
    try {
      updateStatusDisplay({ checking: true });
      const result = await window.trayAPI.checkForUpdates();
      
      if (result.error) {
        updateStatusDisplay({ error: result.error });
      } else {
        // Get current status
        const status = await window.trayAPI.getUpdateStatus();
        updateStatusDisplay({
          checking: false,
          updateAvailable: result.updateAvailable || false,
          version: result.version || status.currentVersion,
          currentVersion: status.currentVersion
        });
      }
    } catch (error) {
      updateStatusDisplay({ error: error.message });
    }
  });
}

// Download update button handler
if (downloadUpdateBtn) {
  downloadUpdateBtn.addEventListener('click', async () => {
    try {
      updateStatusDisplay({ checking: true });
      const result = await window.trayAPI.downloadUpdate();
      
      if (result.error) {
        updateStatusDisplay({ error: result.error });
      } else {
        // Get updated status
        const status = await window.trayAPI.getUpdateStatus();
        updateStatusDisplay({
          checking: false,
          updateDownloaded: status.updateDownloaded || false,
          currentVersion: status.currentVersion
        });
      }
    } catch (error) {
      updateStatusDisplay({ error: error.message });
    }
  });
}

// Install update button handler
if (installUpdateBtn) {
  installUpdateBtn.addEventListener('click', async () => {
    if (!confirm('This will install the update and restart the application. Continue?')) {
      return;
    }
    
    try {
      const result = await window.trayAPI.installUpdate();
      if (result.error) {
        alert(`Failed to install update: ${result.error}`);
      }
      // App will restart, so no need to update UI
    } catch (error) {
      alert(`Failed to install update: ${error.message}`);
    }
  });
}

// Function to load update status
const loadUpdateStatus = async () => {
  try {
    const status = await window.trayAPI.getUpdateStatus();
    updateStatusDisplay({
      checking: false,
      updateAvailable: status.updateAvailable || false,
      updateDownloaded: status.updateDownloaded || false,
      currentVersion: status.currentVersion
    });
  } catch (error) {
    // Silently fail - update status is optional
    console.error('Failed to load update status:', error);
  }
};

if (saveAllBtn) {
  saveAllBtn.addEventListener('click', async () => {
    await saveSettings('all');
  });
}

if (simulateButton) {
  simulateButton.addEventListener('click', async () => {
    setSaveStatus('Simulating SIP call and Acuity API query…');
    try {
      await window.trayAPI.logAction('Test SIP call initiated');
      await window.trayAPI.simulateCall();
      setSaveStatus('Test call simulated - check toast notification', 'success');
      await window.trayAPI.logAction('Test SIP call completed - toast notification shown');
    } catch (error) {
      setSaveStatus('Simulation failed', 'error');
      await window.trayAPI.logAction(`Test SIP call failed: ${error.message}`);
    }
  });
}

autoLaunchToggle.addEventListener('click', () => {
  const current = autoLaunchToggle.getAttribute('aria-checked') === 'true';
  updateToggleVisual(!current);
});


window.trayAPI.onSipStatus(updateSipStatus);
window.trayAPI.onThemeChanged((theme) => {
  document.documentElement.setAttribute('data-theme', theme.theme);
});

// Load About information
const loadAboutInfo = async () => {
  try {
    const appInfo = await window.trayAPI.getAppInfo();
    if (appInfo) {
      document.getElementById('aboutAppName').textContent = appInfo.appName || 'SIP Toast';
      document.getElementById('aboutVersion').textContent = appInfo.version || 'Unknown';
      document.getElementById('aboutBuildDate').textContent = appInfo.buildDate || 'Unknown';
    } else {
      // If appInfo is null/undefined, set defaults
      document.getElementById('aboutAppName').textContent = 'SIP Toast';
      document.getElementById('aboutVersion').textContent = 'Unknown';
      document.getElementById('aboutBuildDate').textContent = 'Unknown';
    }
  } catch (error) {
    console.error('Error loading app info:', error);
    // Set defaults on error
    const aboutAppName = document.getElementById('aboutAppName');
    const aboutVersion = document.getElementById('aboutVersion');
    const aboutBuildDate = document.getElementById('aboutBuildDate');
    if (aboutAppName) aboutAppName.textContent = 'SIP Toast';
    if (aboutVersion) aboutVersion.textContent = 'Unknown';
    if (aboutBuildDate) aboutBuildDate.textContent = 'Unknown';
  }
};

// Window controls - optimized: single event handler setup
const setupWindowControls = () => {
  const minimizeBtn = document.getElementById('minimizeBtn');
  const closeBtn = document.getElementById('closeBtn');

  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', async () => {
      try {
        await window.trayAPI.minimizeWindow();
      } catch (error) {
        // Silently fail - window may already be minimized
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', async () => {
      try {
        await window.trayAPI.closeWindow();
      } catch (error) {
        // Silently fail - window may already be closed
      }
    });
  }
};

// Setup when DOM is ready or immediately if already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    loadAboutInfo();
    setupWindowControls();
  });
} else {
  loadAboutInfo();
  setupWindowControls();
}

// Event Log functionality
const eventLogStream = document.getElementById('eventLogStream');
const logFilterType = document.getElementById('logFilterType');
const logCount = document.getElementById('logCount');
const refreshLogsBtn = document.getElementById('refreshLogsBtn');
const clearLogsBtn = document.getElementById('clearLogsBtn');
const logFilePath = document.getElementById('logFilePath');

const formatEventTimestamp = (isoString) => {
  try {
    const date = new Date(isoString);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  } catch {
    return isoString;
  }
};

const getEventTypeLabel = (type) => {
  const labels = {
    'sip_incoming': '📞 SIP Call',
    'toast_deployed': '🔔 Toast Deployed',
    'toast_timeout': '⏱️ Toast Timeout',
    'toast_click': '👆 Toast Click'
  };
  return labels[type] || type;
};

const formatEventDate = (isoString) => {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    });
  } catch {
    return isoString;
  }
};

const formatEventData = (event) => {
  const { type, timestamp, data } = event;
  let html = `<div class="log-entry log-${type.replace('_', '-')}" style="border-left-color: var(--border-color);">`;
  html += `<span style="min-width: 140px; flex-shrink: 0; color: var(--text-muted); font-size: 11px;">${formatEventTimestamp(timestamp)}</span>`;
  html += `<span style="min-width: 120px; flex-shrink: 0; font-weight: 600; color: var(--text-primary);">${getEventTypeLabel(type)}</span>`;
  
  let details = '';
  if (type === 'sip_incoming') {
    details = `${data.displayName || 'Unknown'} (${data.number || 'N/A'})`;
  } else if (type === 'toast_deployed') {
    details = `${data.callerLabel || 'Unknown'} - ${data.phoneNumber || 'N/A'}`;
    if (data.hasClientInfo) details += ' [Client Match]';
  } else if (type === 'toast_timeout') {
    details = `Duration: ${data.durationSeconds}s - ${data.phoneNumber || 'N/A'}`;
  } else if (type === 'toast_click') {
    details = `Copied ${data.phoneNumber || 'N/A'} to clipboard${data.success ? '' : ' (failed)'}`;
  }
  
  html += `<p style="margin: 0; flex: 1; color: var(--text-primary); word-break: break-word;">${details}</p>`;
  html += `</div>`;
  return html;
};

const groupEventsByDate = (events) => {
  const grouped = {};
  events.forEach(event => {
    const date = new Date(event.timestamp);
    const dateKey = date.toDateString(); // e.g., "Mon Dec 21 2025"
    if (!grouped[dateKey]) {
      grouped[dateKey] = [];
    }
    grouped[dateKey].push(event);
  });
  return grouped;
};

const loadEventLogs = async () => {
  if (!eventLogStream) return;
  
  try {
    const filterType = logFilterType?.value || null;
    
    eventLogStream.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Loading events...</div>';
    
    // Always fetch ALL events (no count limit)
    const events = await window.trayAPI.getAllEvents(filterType);
    
    if (events.length === 0) {
      eventLogStream.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-muted);">No events found</div>';
      return;
    }
    
    // Group events by date
    const grouped = groupEventsByDate(events);
    
    // Sort dates (newest first)
    const sortedDates = Object.keys(grouped).sort((a, b) => {
      return new Date(b) - new Date(a);
    });
    
    // Build HTML with date headers
    let html = '';
    sortedDates.forEach(dateKey => {
      const dateEvents = grouped[dateKey];
      // Sort events within date (newest first)
      dateEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // Date header
      const firstEvent = dateEvents[0];
      html += `<div style="margin: 24px 0 12px 0; padding: 8px 12px; background: var(--bg-secondary, rgba(0,0,0,0.05)); border-left: 3px solid var(--accent-color, #0078d4); border-radius: 4px;">`;
      html += `<strong style="color: var(--text-primary); font-size: 14px;">${formatEventDate(firstEvent.timestamp)}</strong>`;
      html += `<span style="margin-left: 12px; color: var(--text-muted); font-size: 12px;">(${dateEvents.length} event${dateEvents.length !== 1 ? 's' : ''})</span>`;
      html += `</div>`;
      
      // Events for this date
      dateEvents.forEach(event => {
        html += formatEventData(event);
      });
    });
    
    eventLogStream.innerHTML = html;
    
    // Auto-scroll to top (newest)
    eventLogStream.scrollTop = 0;
  } catch (error) {
    console.error('Failed to load event logs:', error);
    eventLogStream.innerHTML = `<div style="padding: 20px; text-align: center; color: #ef4444;">Error loading events: ${error.message}</div>`;
  }
};

const loadLogFilePath = async () => {
  if (!logFilePath) return;
  try {
    const path = await window.trayAPI.getEventLogFilePath();
    logFilePath.textContent = path;
  } catch (error) {
    logFilePath.textContent = 'Unable to load log file path';
  }
};

// Set up event log controls
if (refreshLogsBtn) {
  refreshLogsBtn.addEventListener('click', loadEventLogs);
}

if (clearLogsBtn) {
  clearLogsBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete all event logs? This action cannot be undone.')) {
      return;
    }
    
    try {
      const result = await window.trayAPI.deleteAllEvents();
      if (result.success) {
        // Reload logs (will show empty)
        await loadEventLogs();
        // Show success message
        if (eventLogStream) {
          const originalContent = eventLogStream.innerHTML;
          eventLogStream.innerHTML = '<div style="padding: 20px; text-align: center; color: #10b981;">All logs deleted successfully</div>';
          setTimeout(() => {
            eventLogStream.innerHTML = originalContent;
          }, 2000);
        }
      } else {
        alert(`Failed to delete logs: ${result.message}`);
      }
    } catch (error) {
      console.error('Failed to delete logs:', error);
      alert(`Error deleting logs: ${error.message}`);
    }
  });
}

if (logFilterType) {
  logFilterType.addEventListener('change', loadEventLogs);
}

// Removed logCount event listener - we always show all logs now

// Firewall check elements
const checkFirewallBtn = document.getElementById('checkFirewallBtn');
const refreshFirewallBtn = document.getElementById('refreshFirewallBtn');
const firewallStatusContainer = document.getElementById('firewallStatusContainer');
const firewallLoading = document.getElementById('firewallLoading');
const firewallError = document.getElementById('firewallError');
const firewallStatusText = document.getElementById('firewallStatusText');
const firewallEnabledText = document.getElementById('firewallEnabledText');
const outboundAllowedText = document.getElementById('outboundAllowedText');
const appRulesText = document.getElementById('appRulesText');
const firewallRecommendations = document.getElementById('firewallRecommendations');
const firewallInstructionsSection = document.getElementById('firewallInstructionsSection');
const firewallInstructionsContent = document.getElementById('firewallInstructionsContent');

const checkFirewall = async () => {
  if (!checkFirewallBtn || !firewallStatusContainer) return;
  
  try {
    // Show loading state
    firewallStatusContainer.style.display = 'none';
    firewallError.style.display = 'none';
    firewallLoading.style.display = 'block';
    checkFirewallBtn.disabled = true;
    
    // Check firewall status
    const status = await window.trayAPI.checkFirewall();
    
    // Hide loading
    firewallLoading.style.display = 'none';
    checkFirewallBtn.disabled = false;
    refreshFirewallBtn.style.display = 'inline-block';
    
    // Display results
    displayFirewallStatus(status);
    
    // Load instructions
    const instructions = await window.trayAPI.getFirewallInstructions();
    displayFirewallInstructions(instructions);
    
  } catch (error) {
    console.error('Failed to check firewall:', error);
    firewallLoading.style.display = 'none';
    firewallError.style.display = 'block';
    firewallError.textContent = `Error checking firewall: ${error.message}`;
    checkFirewallBtn.disabled = false;
  }
};

const displayFirewallStatus = (status) => {
  if (!firewallStatusContainer) return;
  
  // Status text with color coding
  const statusColors = {
    'configured': '#10b981', // green
    'permissive': '#f59e0b', // yellow
    'restrictive': '#ef4444', // red
    'disabled': '#6b7280', // gray
    'error': '#ef4444' // red
  };
  
  const statusLabels = {
    'configured': '✓ Configured',
    'permissive': '⚠ Permissive',
    'restrictive': '✗ Restrictive',
    'disabled': '○ Disabled',
    'error': '✗ Error'
  };
  
  if (firewallStatusText) {
    firewallStatusText.textContent = statusLabels[status.status] || status.status;
    firewallStatusText.style.color = statusColors[status.status] || '#6b7280';
  }
  
  if (firewallEnabledText) {
    if (status.firewallEnabled === true) {
      firewallEnabledText.textContent = 'Yes';
      firewallEnabledText.style.color = '#10b981';
    } else if (status.firewallEnabled === false) {
      firewallEnabledText.textContent = 'No';
      firewallEnabledText.style.color = '#6b7280';
    } else {
      firewallEnabledText.textContent = 'Unknown';
      firewallEnabledText.style.color = '#6b7280';
    }
  }
  
  if (outboundAllowedText) {
    if (status.outboundAllowed === true) {
      outboundAllowedText.textContent = 'Yes';
      outboundAllowedText.style.color = '#10b981';
    } else {
      outboundAllowedText.textContent = 'No';
      outboundAllowedText.style.color = '#ef4444';
    }
  }
  
  if (appRulesText) {
    if (status.appRules && status.appRules.length > 0) {
      appRulesText.textContent = `${status.appRules.length} rule(s) found`;
      appRulesText.style.color = '#10b981';
    } else {
      appRulesText.textContent = 'No rules found';
      appRulesText.style.color = '#f59e0b';
    }
  }
  
  // Display recommendations
  if (firewallRecommendations && status.recommendations) {
    let html = '<div class="debug-section"><div class="section-heading"><h3>Recommendations</h3></div>';
    status.recommendations.forEach(rec => {
      const iconColors = {
        'success': '#10b981',
        'warning': '#f59e0b',
        'error': '#ef4444',
        'info': '#3b82f6'
      };
      const icons = {
        'success': '✓',
        'warning': '⚠',
        'error': '✗',
        'info': 'ℹ'
      };
      const color = iconColors[rec.type] || '#6b7280';
      const icon = icons[rec.type] || '•';
      
      html += `<div style="padding: 12px; margin: 8px 0; border-left: 3px solid ${color}; background: var(--bg-secondary, rgba(0,0,0,0.02)); border-radius: 4px;">`;
      html += `<div style="color: ${color}; font-weight: 600; margin-bottom: 4px;">${icon} ${rec.message}</div>`;
      if (rec.action) {
        html += `<div style="color: var(--text-muted); font-size: 12px; margin-top: 4px;">${rec.action}</div>`;
      }
      html += `</div>`;
    });
    html += '</div>';
    firewallRecommendations.innerHTML = html;
  }
  
  firewallStatusContainer.style.display = 'block';
};

const displayFirewallInstructions = (instructions) => {
  if (!firewallInstructionsSection || !firewallInstructionsContent) return;
  
  let html = `<h4 style="margin-bottom: 12px;">${instructions.title}</h4>`;
  
  instructions.steps.forEach((step, index) => {
    html += `<div style="margin-bottom: 16px; padding: 12px; background: var(--bg-secondary, rgba(0,0,0,0.02)); border-radius: 4px;">`;
    html += `<strong style="color: var(--text-primary);">${index + 1}. ${step.title}</strong>`;
    html += `<p style="margin: 8px 0; color: var(--text-muted);">${step.description}</p>`;
    
    if (step.details) {
      html += `<ul style="margin: 8px 0; padding-left: 20px; color: var(--text-muted);">`;
      step.details.forEach(detail => {
        html += `<li>${detail}</li>`;
      });
      html += `</ul>`;
    }
    
    if (step.code) {
      html += `<pre style="margin: 8px 0; padding: 8px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; font-family: monospace; font-size: 11px; overflow-x: auto;"><code>${step.code}</code></pre>`;
    }
    
    html += `</div>`;
  });
  
  if (instructions.notes) {
    html += `<div style="margin-top: 16px; padding: 12px; background: var(--bg-secondary, rgba(59, 130, 246, 0.1)); border-left: 3px solid #3b82f6; border-radius: 4px;">`;
    html += `<strong style="color: #3b82f6;">Notes:</strong>`;
    html += `<ul style="margin: 8px 0; padding-left: 20px; color: var(--text-muted);">`;
    instructions.notes.forEach(note => {
      html += `<li>${note}</li>`;
    });
    html += `</ul></div>`;
  }
  
  firewallInstructionsContent.innerHTML = html;
  firewallInstructionsSection.style.display = 'block';
};

// Set up firewall check button
if (checkFirewallBtn) {
  checkFirewallBtn.addEventListener('click', checkFirewall);
}

if (refreshFirewallBtn) {
  refreshFirewallBtn.addEventListener('click', checkFirewall);
}


const bootstrap = async () => {
  await loadSettings();
  const status = await window.trayAPI.getSipStatus();
  updateSipStatus(status);
  
  // Apply initial theme
  const initialTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', initialTheme);
  
  // Load event logs if on logs section
  const activeSection = document.querySelector('.content-section.active');
  if (activeSection && activeSection.id === 'section-logs') {
    loadEventLogs();
    loadLogFilePath();
  }
};

bootstrap();

