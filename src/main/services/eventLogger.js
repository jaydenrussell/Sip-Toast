const { app } = require('electron');
const { createLogger, format, transports } = require('winston');
const path = require('path');
const os = require('os');
const fs = require('fs');

const resolveLogDirectory = () => {
  try {
    if (app?.getPath) {
      return path.join(app.getPath('userData'), 'logs');
    }
  } catch (error) {
    // Fallback below if app isn't ready yet.
  }

  return path.join(os.homedir(), 'AppData', 'Roaming', 'sip-toast', 'logs');
};

const logDir = resolveLogDirectory();
fs.mkdirSync(logDir, { recursive: true });
const eventLogFilePath = path.join(logDir, 'sip-toast-events.log');
const eventJsonFilePath = path.join(logDir, 'sip-toast-events.json');

// Event log buffer with memory limit to prevent unbounded growth
// Events are persisted to file, so this is just a hot cache for recent events
const MAX_IN_MEMORY_EVENTS = 1000; // Keep last 1000 events in memory (~500KB max)
const eventLogBuffer = [];

const eventLogger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.printf(info => {
      const { timestamp, level, message, ...meta } = info;
      const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      return `${timestamp} [${level.toUpperCase()}] ${message}${metaStr}`;
    })
  ),
  transports: [
    new transports.File({
      filename: eventLogFilePath,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 10,
      tailable: true
    })
  ]
});

// Get the current JSON file path (may change if app.getPath becomes available)
const getEventJsonFilePath = () => {
  const currentLogDir = resolveLogDirectory();
  return path.join(currentLogDir, 'sip-toast-events.json');
};

// Write event to JSON file (one event per line for easy parsing)
const writeEventToJsonFile = (event) => {
  try {
    // Use current log directory (in case it changed)
    const jsonFilePath = getEventJsonFilePath();
    // Append event as JSON line
    const jsonLine = JSON.stringify(event) + '\n';
    fs.appendFileSync(jsonFilePath, jsonLine, 'utf8');
  } catch (error) {
    console.error('Failed to write event to JSON file:', error);
  }
};

// Helper to add event to buffer with memory limit and persist to file
const addToBuffer = (event) => {
  // Enforce memory limit - remove oldest events if buffer is full
  if (eventLogBuffer.length >= MAX_IN_MEMORY_EVENTS) {
    eventLogBuffer.shift(); // Remove oldest event (O(n) but necessary for array)
  }
  eventLogBuffer.push(event);
  // Also write to JSON file for persistence (full history is in file)
  writeEventToJsonFile(event);
};

// Log incoming SIP call
const logIncomingCall = (callData) => {
  const event = {
    type: 'sip_incoming',
    timestamp: new Date().toISOString(),
    data: {
      displayName: callData.displayName,
      number: callData.number,
      normalizedNumber: callData.normalizedNumber || callData.number?.replace(/[^\d]/g, '')
    }
  };
  
  eventLogger.info(`SIP_INCOMING: Call from ${callData.displayName} (${callData.number})`, event);
  addToBuffer(event);
  return event;
};

// Log toast deployment
const logToastDeployed = (toastData) => {
  const event = {
    type: 'toast_deployed',
    timestamp: new Date().toISOString(),
    data: {
      callerLabel: toastData.callerLabel,
      phoneNumber: toastData.phoneNumber,
      hasClientInfo: !!toastData.clientName,
      lookupState: toastData.lookupState || 'unknown'
    }
  };
  
  eventLogger.info(`TOAST_DEPLOYED: ${toastData.callerLabel} (${toastData.phoneNumber})`, event);
  addToBuffer(event);
  return event;
};

// Log toast timeout
const logToastTimeout = (durationMs, phoneNumber) => {
  const durationSeconds = (durationMs / 1000).toFixed(2);
  const event = {
    type: 'toast_timeout',
    timestamp: new Date().toISOString(),
    data: {
      durationMs,
      durationSeconds: parseFloat(durationSeconds),
      phoneNumber: phoneNumber || 'unknown'
    }
  };
  
  eventLogger.info(`TOAST_TIMEOUT: Duration ${durationSeconds}s for ${phoneNumber || 'unknown'}`, event);
  addToBuffer(event);
  return event;
};

// Log toast click/copy
const logToastClick = (phoneNumber, success = true) => {
  const event = {
    type: 'toast_click',
    timestamp: new Date().toISOString(),
    data: {
      phoneNumber: phoneNumber || 'unknown',
      action: 'copy',
      success
    }
  };
  
  eventLogger.info(`TOAST_CLICK: User copied ${phoneNumber || 'unknown'} to clipboard`, event);
  addToBuffer(event);
  return event;
};

// Log update check
const logUpdateCheck = (trigger = 'manual') => {
  const event = {
    type: 'update_check',
    timestamp: new Date().toISOString(),
    data: {
      trigger // 'manual', 'auto', 'app_load'
    }
  };
  
  eventLogger.info(`UPDATE_CHECK: Check triggered by ${trigger}`, event);
  addToBuffer(event);
  return event;
};

// Log update available
const logUpdateAvailable = (version, downloadUrl = null) => {
  const event = {
    type: 'update_available',
    timestamp: new Date().toISOString(),
    data: {
      version,
      downloadUrl
    }
  };
  
  eventLogger.info(`UPDATE_AVAILABLE: Version ${version} is available`, event);
  addToBuffer(event);
  return event;
};

// Log update downloaded
const logUpdateDownloaded = (version, filePath = null) => {
  const event = {
    type: 'update_downloaded',
    timestamp: new Date().toISOString(),
    data: {
      version,
      filePath
    }
  };
  
  eventLogger.info(`UPDATE_DOWNLOADED: Version ${version} downloaded`, event);
  addToBuffer(event);
  return event;
};

// Log update installed
const logUpdateInstalled = (version) => {
  const event = {
    type: 'update_installed',
    timestamp: new Date().toISOString(),
    data: {
      version
    }
  };
  
  eventLogger.info(`UPDATE_INSTALLED: Version ${version} installed`, event);
  addToBuffer(event);
  return event;
};

// Log update error
const logUpdateError = (errorMessage, context = '') => {
  const event = {
    type: 'update_error',
    timestamp: new Date().toISOString(),
    data: {
      error: errorMessage,
      context
    }
  };
  
  eventLogger.error(`UPDATE_ERROR: ${errorMessage} (${context})`, event);
  addToBuffer(event);
  return event;
};

// Log SIP registration attempt
const logSipRegistering = (eventData) => {
  const event = {
    type: 'sip_registering',
    timestamp: new Date().toISOString(),
    data: {
      server: eventData.server,
      transport: eventData.transport,
      username: eventData.username
    }
  };
  
  eventLogger.info(`SIP_REGISTERING: Attempting to register to ${eventData.server} (${eventData.transport})`, event);
  addToBuffer(event);
  return event;
};

// Log SIP successful registration
const logSipRegistered = (eventData) => {
  const event = {
    type: 'sip_registered',
    timestamp: new Date().toISOString(),
    data: {
      server: eventData.server,
      transport: eventData.transport,
      username: eventData.username,
      expires: eventData.expires
    }
  };
  
  eventLogger.info(`SIP_REGISTERED: Successfully registered to ${eventData.server} as ${eventData.username}`, event);
  addToBuffer(event);
  return event;
};

// Log SIP disconnection
const logSipDisconnected = (eventData) => {
  const event = {
    type: 'sip_disconnected',
    timestamp: new Date().toISOString(),
    data: {
      server: eventData.server,
      transport: eventData.transport,
      username: eventData.username,
      reason: eventData.reason || 'stopped'
    }
  };
  
  eventLogger.info(`SIP_DISCONNECTED: Disconnected from ${eventData.server} (reason: ${eventData.reason || 'stopped'})`, event);
  addToBuffer(event);
  return event;
};

// Log SIP error
const logSipError = (errorMessage, eventData) => {
  const event = {
    type: 'sip_error',
    timestamp: new Date().toISOString(),
    data: {
      server: eventData.server,
      transport: eventData.transport,
      username: eventData.username,
      error: errorMessage,
      statusCode: eventData.statusCode,
      cause: eventData.cause
    }
  };
  
  eventLogger.error(`SIP_ERROR: ${errorMessage} (server: ${eventData.server})`, event);
  addToBuffer(event);
  return event;
};

// Get recent events
const getRecentEvents = (count = 100, filterType = null) => {
  let events = eventLogBuffer.slice(-count);
  if (filterType) {
    events = events.filter(e => e.type === filterType);
  }
  return events;
};

// Get all events by type
const getEventsByType = (type) => {
  return eventLogBuffer.filter(e => e.type === type);
};

// Get events in date range
const getEventsInRange = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  return eventLogBuffer.filter(e => {
    const eventDate = new Date(e.timestamp);
    return eventDate >= start && eventDate <= end;
  });
};

// Get all events (no limit)
const getAllEvents = (filterType = null) => {
  let events = [...eventLogBuffer]; // Return copy
  if (filterType) {
    events = events.filter(e => e.type === filterType);
  }
  // Sort by timestamp (oldest first)
  return events.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
};

// Delete all events (clear buffer and log files)
const deleteAllEvents = () => {
  try {
    // Clear in-memory buffer
    eventLogBuffer.length = 0;
    
    // Clear log file by truncating it
    if (fs.existsSync(eventLogFilePath)) {
      fs.writeFileSync(eventLogFilePath, '', 'utf8');
    }
    
    // Clear JSON file (use current path)
    const jsonFilePath = getEventJsonFilePath();
    if (fs.existsSync(jsonFilePath)) {
      fs.writeFileSync(jsonFilePath, '', 'utf8');
    }
    
    return { success: true, message: 'All events deleted successfully' };
  } catch (error) {
    return { success: false, message: `Failed to delete events: ${error.message}` };
  }
};

// Load events from JSON file on startup (if file exists and has content)
// Memory optimization: Only load the most recent MAX_IN_MEMORY_EVENTS events
const loadEventsFromFile = (clearBuffer = false) => {
  try {
    // Clear buffer if requested (to avoid duplicates on reload)
    if (clearBuffer) {
      eventLogBuffer.length = 0;
    }
    
    // Use current log directory (in case it changed)
    const jsonFilePath = getEventJsonFilePath();
    
    // First try to load from JSON file (preferred format)
    if (fs.existsSync(jsonFilePath)) {
      const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
      if (jsonContent.trim()) {
        const lines = jsonContent.split('\n').filter(line => line.trim());
        
        // Memory optimization: Only load the most recent events
        // Start from the end of the file and work backwards
        const startIndex = Math.max(0, lines.length - MAX_IN_MEMORY_EVENTS);
        let loadedCount = 0;
        
        for (let i = startIndex; i < lines.length; i++) {
          const line = lines[i];
          try {
            const event = JSON.parse(line);
            // Validate event structure
            if (event && event.type && event.timestamp && event.data) {
              // Only add if not already in buffer (avoid duplicates)
              const exists = eventLogBuffer.some(e => 
                e.type === event.type && 
                e.timestamp === event.timestamp
              );
              if (!exists) {
                eventLogBuffer.push(event);
                loadedCount++;
              }
            }
          } catch (error) {
            // Skip invalid JSON lines
          }
        }
        if (loadedCount > 0) {
          console.log(`Loaded ${loadedCount} events from JSON file (total: ${eventLogBuffer.length})`);
        }
        return;
      }
    }
    
    // Fallback: Try to parse winston log format if JSON file doesn't exist
    if (fs.existsSync(eventLogFilePath)) {
      const fileContent = fs.readFileSync(eventLogFilePath, 'utf8');
      if (!fileContent.trim()) {
        return;
      }
      
      // Parse winston log format: "YYYY-MM-DD HH:mm:ss.SSS [LEVEL] message {json}"
      const lines = fileContent.split('\n').filter(line => line.trim());
      let loadedCount = 0;
      lines.forEach(line => {
        try {
          // Winston format: "2025-12-21 21:21:08.617 [INFO] SIP_INCOMING: Call from ... {...}"
          const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}) \[(\w+)\] (.+?)(?:\s+(\{.*\}))?$/);
          if (match) {
            const [, timestamp, level, message, jsonStr] = match;
            // Convert timestamp to ISO format
            const date = new Date(timestamp.replace(' ', 'T'));
            const isoTimestamp = date.toISOString();
            
            // Try to parse JSON metadata if present
            if (jsonStr) {
              try {
                const parsed = JSON.parse(jsonStr);
                if (parsed.type && parsed.timestamp && parsed.data) {
                  // This is our structured event
                  eventLogBuffer.push(parsed);
                  loadedCount++;
                  return;
                }
              } catch (e) {
                // Not valid JSON, continue
              }
            }
            
            // If we can't parse structured data, create a basic event from the log line
            const typeMatch = message.match(/^(SIP_INCOMING|TOAST_DEPLOYED|TOAST_TIMEOUT|TOAST_CLICK):/);
            if (typeMatch) {
              const type = typeMatch[1].toLowerCase().replace(/_/g, '_');
              eventLogBuffer.push({
                type,
                timestamp: isoTimestamp,
                data: { rawMessage: message }
              });
              loadedCount++;
            }
          }
        } catch (error) {
          // Skip lines that can't be parsed
        }
      });
      if (loadedCount > 0) {
        console.log(`Loaded ${loadedCount} events from winston log file`);
      }
    }
  } catch (error) {
    // If file reading fails, just continue with empty buffer
    console.error('Failed to load events from file:', error);
  }
};

// Try to load immediately (may use fallback path if app.getPath not available)
// Will be reloaded after app is ready to ensure correct path
loadEventsFromFile();

module.exports = {
  logIncomingCall,
  logToastDeployed,
  logToastTimeout,
  logToastClick,
  logUpdateCheck,
  logUpdateAvailable,
  logUpdateDownloaded,
  logUpdateInstalled,
  logUpdateError,
  logSipRegistering,
  logSipRegistered,
  logSipDisconnected,
  logSipError,
  getRecentEvents,
  getEventsByType,
  getEventsInRange,
  getAllEvents,
  deleteAllEvents,
  getEventLogFilePath: () => eventLogFilePath,
  reloadEvents: () => loadEventsFromFile(true) // Clear buffer before reloading
};
