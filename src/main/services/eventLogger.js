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

// Event log buffer for in-memory access
const eventLogBuffer = [];
// Removed MAX_BUFFER_SIZE limit - keep all events in memory for full log access

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

// Helper to add event to buffer and persist to file
const addToBuffer = (event) => {
  eventLogBuffer.push(event);
  // Also write to JSON file for persistence
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
const loadEventsFromFile = (clearBuffer = false) => {
  try {
    // Clear buffer if requested (to avoid duplicates on reload)
    if (clearBuffer) {
      eventLogBuffer.length = 0;
      console.log('Event log buffer cleared for reload');
    }
    
    // Use current log directory (in case it changed)
    const jsonFilePath = getEventJsonFilePath();
    console.log(`Loading events from: ${jsonFilePath}`);
    
    // First try to load from JSON file (preferred format)
    if (fs.existsSync(jsonFilePath)) {
      const jsonContent = fs.readFileSync(jsonFilePath, 'utf8');
      if (jsonContent.trim()) {
        const lines = jsonContent.split('\n').filter(line => line.trim());
        let loadedCount = 0;
        let duplicateCount = 0;
        lines.forEach(line => {
          try {
            const event = JSON.parse(line);
            // Validate event structure
            if (event && event.type && event.timestamp && event.data) {
              // Only add if not already in buffer (avoid duplicates)
              // Use a more robust comparison that handles different property orders
              const exists = eventLogBuffer.some(e => 
                e.type === event.type && 
                e.timestamp === event.timestamp
              );
              if (!exists) {
                eventLogBuffer.push(event);
                loadedCount++;
              } else {
                duplicateCount++;
              }
            }
          } catch (error) {
            // Skip invalid JSON lines
            console.debug(`Skipping invalid JSON line: ${error.message}`);
          }
        });
        console.log(`Loaded ${loadedCount} events from JSON file (duplicates skipped: ${duplicateCount}, total in buffer: ${eventLogBuffer.length})`);
        return;
      } else {
        console.log('JSON file exists but is empty');
      }
    } else {
      console.log('JSON file does not exist yet');
    }
    
    // Fallback: Try to parse winston log format if JSON file doesn't exist
    if (fs.existsSync(eventLogFilePath)) {
      console.log(`Attempting to load from winston log file: ${eventLogFilePath}`);
      const fileContent = fs.readFileSync(eventLogFilePath, 'utf8');
      if (!fileContent.trim()) {
        console.log('Winston log file is empty');
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
                  // This is our structured event - check for duplicates
                  const exists = eventLogBuffer.some(e => 
                    e.type === parsed.type && 
                    e.timestamp === parsed.timestamp
                  );
                  if (!exists) {
                    eventLogBuffer.push(parsed);
                    loadedCount++;
                  }
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
              const exists = eventLogBuffer.some(e => 
                e.type === type && 
                e.timestamp === isoTimestamp
              );
              if (!exists) {
                eventLogBuffer.push({
                  type,
                  timestamp: isoTimestamp,
                  data: { rawMessage: message }
                });
                loadedCount++;
              }
            }
          }
        } catch (error) {
          // Skip lines that can't be parsed
          console.debug(`Skipping unparseable log line: ${error.message}`);
        }
      });
      if (loadedCount > 0) {
        console.log(`Loaded ${loadedCount} events from winston log file (total: ${eventLogBuffer.length})`);
      }
    } else {
      console.log('No existing log files found, starting with empty event buffer');
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
  getRecentEvents,
  getEventsByType,
  getEventsInRange,
  getAllEvents,
  deleteAllEvents,
  getEventLogFilePath: () => eventLogFilePath,
  reloadEvents: () => loadEventsFromFile(true) // Clear buffer before reloading
};
