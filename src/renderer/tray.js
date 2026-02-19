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
  updates: { title: 'Updates', subtitle: 'Check for and install software updates' },
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
  'toast.numberColor',
  'toast.callerIdFont',
  'toast.callerIdFontSize',
  'toast.callerIdColor'
];

// Color picker event handlers - update display when color changes
const callerIdColorInput = document.getElementById('callerIdColorInput');
const callerIdColorValue = document.getElementById('callerIdColorValue');
const numberColorInput = document.getElementById('numberColorInput');
const numberColorValue = document.getElementById('numberColorValue');

if (callerIdColorInput && callerIdColorValue) {
  callerIdColorInput.addEventListener('input', (e) => {
    callerIdColorValue.textContent = e.target.value.toUpperCase();
  });
}

if (numberColorInput && numberColorValue) {
  numberColorInput.addEventListener('input', (e) => {
    numberColorValue.textContent = e.target.value.toUpperCase();
  });
}

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
    app: {}
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
      app: payload.app
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
const acuityEnabledToggle = document.getElementById('acuityEnabledToggle');
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
    'sip_registering': '📡 SIP Registering',
    'sip_registered': '✅ SIP Registered',
    'sip_disconnected': '❌ SIP Disconnected',
    'sip_error': '⚠️ SIP Error',
    'toast_deployed': '🔔 Toast Deployed',
    'toast_timeout': '⏱️ Toast Timeout',
    'toast_click': '👆 Toast Click',
    'update_check': '🔄 Update Check',
    'update_available': '📥 Update Available',
    'update_downloaded': '✅ Update Downloaded',
    'update_installed': '🎉 Update Installed',
    'update_error': '❌ Update Error'
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
  } else if (type === 'sip_registering') {
    details = `Connecting to ${data.server || 'N/A'} via ${data.transport || 'UDP'}`;
  } else if (type === 'sip_registered') {
    details = `Connected to ${data.server || 'N/A'} as ${data.username || 'N/A'}`;
  } else if (type === 'sip_disconnected') {
    details = `Disconnected from ${data.server || 'N/A'} (${data.reason || 'stopped'})`;
  } else if (type === 'sip_error') {
    details = `${data.error || 'Unknown error'}`;
    if (data.server) details += ` - Server: ${data.server}`;
    if (data.statusCode) details += ` (Status: ${data.statusCode})`;
  } else if (type === 'toast_deployed') {
    details = `${data.callerLabel || 'Unknown'} - ${data.phoneNumber || 'N/A'}`;
    if (data.hasClientInfo) details += ' [Client Match]';
  } else if (type === 'toast_timeout') {
    details = `Duration: ${data.durationSeconds}s - ${data.phoneNumber || 'N/A'}`;
  } else if (type === 'toast_click') {
    details = `Copied ${data.phoneNumber || 'N/A'} to clipboard${data.success ? '' : ' (failed)'}`;
  } else if (type === 'update_check') {
    details = `Check triggered by ${data.trigger || 'unknown'}`;
  } else if (type === 'update_available') {
    details = `Version ${data.version || 'unknown'} available`;
    if (data.downloadUrl) details += ` - ${data.downloadUrl}`;
  } else if (type === 'update_downloaded') {
    details = `Version ${data.version || 'unknown'} downloaded and ready`;
    if (data.filePath) details += ` - ${data.filePath}`;
  } else if (type === 'update_installed') {
    details = `Version ${data.version || 'unknown'} installed - restarting app`;
  } else if (type === 'update_error') {
    details = `${data.error || 'Unknown error'}`;
    if (data.context) details += ` (during ${data.context})`;
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

// Sidebar update status chip - shows when update is ready
const updateStatusChip = document.getElementById('updateStatus');

// Make update chip clickable - install update or navigate to About section
if (updateStatusChip) {
  updateStatusChip.style.cursor = 'pointer';
  updateStatusChip.addEventListener('click', async () => {
    // If update is downloaded, install it directly
    if (currentUpdateStatus && currentUpdateStatus.updateDownloaded) {
      try {
        await window.trayAPI.quitAndInstallUpdate();
      } catch (error) {
        console.error('Failed to install update:', error);
      }
      return;
    }
    
    // Otherwise navigate to Updates section
    navItems.forEach((nav) => nav.classList.remove('active'));
    const updatesNavItem = document.querySelector('.nav-item[data-section="updates"]');
    if (updatesNavItem) {
      updatesNavItem.classList.add('active');
    }
    document.querySelectorAll('.content-section').forEach((sec) => {
      sec.classList.remove('active');
    });
    const updatesSection = document.getElementById('section-updates');
    if (updatesSection) {
      updatesSection.classList.add('active');
    }
    sectionTitle.textContent = 'Updates';
    sectionSubtitle.textContent = 'Check for and install software updates';
  });
}

// Update section elements
const checkUpdatesBtn = document.getElementById('checkUpdatesBtn');
const installUpdateBtn = document.getElementById('installUpdateBtn');
const updateCurrentVersion = document.getElementById('updateCurrentVersion');
const updateAvailableRow = document.getElementById('updateAvailableRow');
const updateAvailableVersion = document.getElementById('updateAvailableVersion');
const updateProgressRow = document.getElementById('updateProgressRow');
const updateDownloadProgress = document.getElementById('updateDownloadProgress');
const updateMessage = document.getElementById('updateMessage');

// Store current update status for reference
let currentUpdateStatus = null;

// Update the sidebar chip based on update status (Discord-style)
const updateSidebarChip = (status) => {
  if (!updateStatusChip) return;
  
  currentUpdateStatus = status;
  
  // Only show chip when update is DOWNLOADED and ready (Discord-style)
  if (status.updateDownloaded) {
    updateStatusChip.style.display = 'flex';
    updateStatusChip.querySelector('.update-text').textContent = 'Update Ready';
    updateStatusChip.title = 'Click to install update';
  } else if (status.downloading) {
    // Show downloading progress
    updateStatusChip.style.display = 'flex';
    updateStatusChip.querySelector('.update-text').textContent = `Updating ${status.downloadProgress}%`;
    updateStatusChip.title = 'Downloading update...';
  } else if (status.checking) {
    // Show checking status
    updateStatusChip.style.display = 'flex';
    updateStatusChip.querySelector('.update-text').textContent = 'Checking...';
    updateStatusChip.title = 'Checking for updates...';
  } else {
    updateStatusChip.style.display = 'none';
  }
};

// Update the About section update UI
const updateAboutSection = (status) => {
  if (!updateCurrentVersion) return;
  
  // Update current version
  updateCurrentVersion.textContent = status.currentVersion || 'Unknown';
  
  // Show/hide available version row
  if (status.updateAvailable && status.availableVersion) {
    updateAvailableRow.style.display = 'flex';
    updateAvailableVersion.textContent = status.availableVersion;
  } else {
    updateAvailableRow.style.display = 'none';
  }
  
  // Show/hide download progress
  if (status.downloadProgress > 0 && !status.updateDownloaded) {
    updateProgressRow.style.display = 'flex';
    updateDownloadProgress.textContent = `${status.downloadProgress}%`;
  } else {
    updateProgressRow.style.display = 'none';
  }
  
  // Update message and buttons
  if (status.updateDownloaded) {
    updateMessage.style.display = 'block';
    updateMessage.style.background = 'rgba(16, 185, 129, 0.1)';
    updateMessage.style.color = '#10b981';
    updateMessage.innerHTML = `✅ Update v${status.availableVersion} downloaded and ready to install. Click "Install Update" to restart and apply the update.`;
    installUpdateBtn.style.display = 'inline-block';
    checkUpdatesBtn.textContent = 'Check for Updates';
    checkUpdatesBtn.disabled = false;
  } else if (status.updateAvailable) {
    updateMessage.style.display = 'block';
    updateMessage.style.background = 'rgba(16, 185, 129, 0.1)';
    updateMessage.style.color = '#10b981';
    updateMessage.innerHTML = `📥 Update v${status.availableVersion} is available. Downloading...`;
    installUpdateBtn.style.display = 'none';
    checkUpdatesBtn.textContent = 'Downloading...';
    checkUpdatesBtn.disabled = true;
  } else if (status.checking) {
    updateMessage.style.display = 'block';
    updateMessage.style.background = 'rgba(59, 130, 246, 0.1)';
    updateMessage.style.color = '#3b82f6';
    updateMessage.innerHTML = '🔍 Checking for updates...';
    installUpdateBtn.style.display = 'none';
    checkUpdatesBtn.textContent = 'Checking...';
    checkUpdatesBtn.disabled = true;
  } else {
    updateMessage.style.display = 'none';
    installUpdateBtn.style.display = 'none';
    checkUpdatesBtn.textContent = 'Check for Updates';
    checkUpdatesBtn.disabled = false;
  }
};

// Check for updates button handler
if (checkUpdatesBtn) {
  checkUpdatesBtn.addEventListener('click', async () => {
    try {
      checkUpdatesBtn.disabled = true;
      checkUpdatesBtn.textContent = 'Checking...';
      await window.trayAPI.checkForUpdates();
    } catch (error) {
      console.error('Failed to check for updates:', error);
      updateMessage.style.display = 'block';
      updateMessage.style.background = 'rgba(239, 68, 68, 0.1)';
      updateMessage.style.color = '#ef4444';
      updateMessage.innerHTML = `❌ Failed to check for updates: ${error.message}`;
      checkUpdatesBtn.disabled = false;
      checkUpdatesBtn.textContent = 'Check for Updates';
    }
  });
}

// Install update button handler
if (installUpdateBtn) {
  installUpdateBtn.addEventListener('click', async () => {
    try {
      installUpdateBtn.disabled = true;
      installUpdateBtn.textContent = 'Installing...';
      
      // Show the update overlay
      const updateOverlay = document.getElementById('updateOverlay');
      const updateOverlayTitle = document.getElementById('updateOverlayTitle');
      const updateOverlayMessage = document.getElementById('updateOverlayMessage');
      const updateProgressBar = document.getElementById('updateProgressBar');
      
      if (updateOverlay) {
        updateOverlay.style.display = 'flex';
        if (updateOverlayTitle) updateOverlayTitle.textContent = 'Installing Update...';
        if (updateOverlayMessage) updateOverlayMessage.textContent = 'Please wait while the update is being installed.';
        if (updateProgressBar) updateProgressBar.style.width = '50%';
      }
      
      await window.trayAPI.quitAndInstallUpdate();
    } catch (error) {
      console.error('Failed to install update:', error);
      installUpdateBtn.disabled = false;
      installUpdateBtn.textContent = 'Install Update';
      
      // Hide overlay on error
      const updateOverlay = document.getElementById('updateOverlay');
      if (updateOverlay) updateOverlay.style.display = 'none';
    }
  });
}

// Also show overlay when clicking the sidebar chip if update is ready
if (updateStatusChip) {
  const originalClickHandler = updateStatusChip.onclick;
  updateStatusChip.addEventListener('click', async (e) => {
    if (currentUpdateStatus && currentUpdateStatus.updateDownloaded) {
      // Show overlay before installing
      const updateOverlay = document.getElementById('updateOverlay');
      const updateOverlayTitle = document.getElementById('updateOverlayTitle');
      const updateOverlayMessage = document.getElementById('updateOverlayMessage');
      const updateProgressBar = document.getElementById('updateProgressBar');
      
      if (updateOverlay) {
        updateOverlay.style.display = 'flex';
        if (updateOverlayTitle) updateOverlayTitle.textContent = 'Installing Update...';
        if (updateOverlayMessage) updateOverlayMessage.textContent = 'Please wait while the update is being installed.';
        if (updateProgressBar) updateProgressBar.style.width = '50%';
      }
    }
  });
}

// Listen for update status changes and update overlay progress
window.trayAPI.onUpdateStatus((status) => {
  updateSidebarChip(status);
  updateAboutSection(status);
  
  // Update overlay if visible
  const updateOverlay = document.getElementById('updateOverlay');
  const updateProgressBar = document.getElementById('updateProgressBar');
  
  if (updateOverlay && updateOverlay.style.display === 'flex') {
    if (status.downloading && updateProgressBar) {
      updateProgressBar.style.width = `${status.downloadProgress}%`;
    }
  }
});

// Listen for update status changes from main process
window.trayAPI.onUpdateStatus((status) => {
  updateSidebarChip(status);
  updateAboutSection(status);
});


const bootstrap = async () => {
  await loadSettings();
  const status = await window.trayAPI.getSipStatus();
  updateSipStatus(status);
  
  // Apply initial theme
  const initialTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', initialTheme);
  
  // Load initial update status
  try {
    const updateStatus = await window.trayAPI.getUpdateStatus();
    if (updateStatus && !updateStatus.error) {
      updateSidebarChip(updateStatus);
      updateAboutSection(updateStatus);
    }
  } catch (error) {
    console.debug('Could not load initial update status:', error);
  }
  
  // Load event logs if on logs section
  const activeSection = document.querySelector('.content-section.active');
  if (activeSection && activeSection.id === 'section-logs') {
    loadEventLogs();
    loadLogFilePath();
  }
};

bootstrap();