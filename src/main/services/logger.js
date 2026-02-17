const { app } = require('electron');
const { createLogger, format, transports } = require('winston');
const path = require('path');
const os = require('os');
const fs = require('fs');
const EventEmitter = require('events');

// Dynamic log buffer size - reduces when minimized to save memory
let LOG_BUFFER_SIZE = 100; // Normal size (100 entries ~50KB)
const LOG_BUFFER_SIZE_MINIMIZED = 50; // Reduced when minimized (50 entries ~25KB)
const logEmitter = new EventEmitter();

// Use a more efficient circular buffer implementation
// This avoids O(n) shift operations and reduces memory fragmentation
const memoryBuffer = [];
let bufferHead = 0; // Index of oldest entry
let bufferCount = 0; // Current number of entries

// Function to adjust log buffer size based on window visibility
const adjustLogBufferSize = (isMinimized) => {
  const targetSize = isMinimized ? LOG_BUFFER_SIZE_MINIMIZED : LOG_BUFFER_SIZE;
  
  // Trim buffer if it's larger than target
  while (bufferCount > targetSize) {
    // Remove oldest entry by advancing head pointer (O(1) operation)
    memoryBuffer[bufferHead] = null; // Allow GC to reclaim memory
    bufferHead = (bufferHead + 1) % LOG_BUFFER_SIZE;
    bufferCount--;
  }
  
  LOG_BUFFER_SIZE = targetSize;
};

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
const logFilePath = path.join(logDir, 'sip-toast.log');

const loggerInstance = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.printf(info => `${info.timestamp} [${info.level}] ${info.message}${info.stack ? `\n${info.stack}` : ''}`)
  ),
  transports: [
    new transports.Console({ format: format.simple() }),
    new transports.File({
      filename: logFilePath,
      maxsize: 2 * 1024 * 1024,
      maxFiles: 5,
      tailable: true
    })
  ]
});

// Security: Sanitize log messages to remove sensitive data
const sanitizeMessage = (message) => {
  if (typeof message !== 'string') {
    message = String(message);
  }
  
  // Remove potential password/API key patterns
  // Match patterns like: password=xxx, apiKey=xxx, api_key=xxx, etc.
  const sensitivePatterns = [
    /password\s*[:=]\s*['"]?[^'",\s]+['"]?/gi,
    /api[_-]?key\s*[:=]\s*['"]?[^'",\s]+['"]?/gi,
    /apiKey\s*[:=]\s*['"]?[^'",\s]+['"]?/gi,
    /auth[_-]?token\s*[:=]\s*['"]?[^'",\s]+['"]?/gi,
    /secret\s*[:=]\s*['"]?[^'",\s]+['"]?/gi,
    /userId\s*[:=]\s*['"]?[^'",\s]+['"]?/gi
  ];
  
  let sanitized = message;
  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, (match) => {
      // Replace with redacted version
      const prefix = match.split(/[:=]/)[0];
      return `${prefix}=[REDACTED]`;
    });
  }
  
  return sanitized;
};

const pushToBuffer = (entry) => {
  // Security: Sanitize messages to remove sensitive data
  const sanitizedMessage = sanitizeMessage(entry.message);
  const optimizedEntry = {
    level: entry.level,
    message: sanitizedMessage.length > 500 
      ? sanitizedMessage.substring(0, 500) + '...' 
      : sanitizedMessage,
    timestamp: entry.timestamp
    // Don't store meta to save memory
  };
  
  // Use circular buffer approach - O(1) operations
  const currentBufferSize = typeof LOG_BUFFER_SIZE === 'number' ? LOG_BUFFER_SIZE : 100;
  
  if (bufferCount < currentBufferSize) {
    // Buffer not full yet, just add
    memoryBuffer.push(optimizedEntry);
    bufferCount++;
  } else {
    // Buffer full, overwrite oldest entry (circular)
    memoryBuffer[bufferHead] = optimizedEntry;
    bufferHead = (bufferHead + 1) % currentBufferSize;
  }
  
  // Emit sanitized entry for real-time display
  const sanitizedEntry = {
    ...entry,
    message: sanitizeMessage(entry.message)
  };
  logEmitter.emit('entry', sanitizedEntry);
};

const originalLog = loggerInstance.log.bind(loggerInstance);
loggerInstance.log = (level, message, ...meta) => {
  let payload;
  if (typeof level === 'object') {
    payload = level;
  } else {
    payload = { level, message };
    if (meta.length) {
      payload.meta = meta;
    }
  }

  // Security: Sanitize message before logging
  const rawMessage = typeof payload.message === 'string' 
    ? payload.message 
    : JSON.stringify(payload.message);
  const sanitizedMessage = sanitizeMessage(rawMessage);

  const entry = {
    level: payload.level || 'info',
    message: sanitizedMessage,
    timestamp: new Date().toISOString(),
    meta: payload.meta ?? undefined
  };

  pushToBuffer(entry);
  
  // Log sanitized message to file/console
  const sanitizedPayload = {
    ...payload,
    message: sanitizedMessage
  };
  return originalLog(sanitizedPayload);
};

module.exports = {
  logger: loggerInstance,
  logEmitter,
  getRecentLogs(count = 100) {
    // Handle circular buffer - return entries in chronological order
    if (bufferCount === 0) {
      return [];
    }
    
    // If buffer is not full, just return the last 'count' entries
    if (bufferCount < memoryBuffer.length) {
      return memoryBuffer.slice(-count);
    }
    
    // Buffer is full - need to handle circular nature
    // Get the actual number of entries to return
    const returnCount = Math.min(count, bufferCount);
    
    // Build result array in chronological order
    const result = [];
    const startIdx = (bufferHead + bufferCount - returnCount) % bufferCount;
    
    for (let i = 0; i < returnCount; i++) {
      const idx = (startIdx + i) % bufferCount;
      result.push(memoryBuffer[idx]);
    }
    
    return result;
  },
  getLogFilePath() {
    return logFilePath;
  },
  adjustLogBufferSize
};

