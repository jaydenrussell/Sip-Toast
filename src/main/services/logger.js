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
const memoryBuffer = [];

// Function to adjust log buffer size based on window visibility
const adjustLogBufferSize = (isMinimized) => {
  const targetSize = isMinimized ? LOG_BUFFER_SIZE_MINIMIZED : LOG_BUFFER_SIZE;
  if (memoryBuffer.length > targetSize) {
    // Trim buffer if it's larger than target
    memoryBuffer.splice(0, memoryBuffer.length - targetSize);
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
  // Use circular buffer approach - more memory efficient
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
  
  // Use current buffer size (may be reduced when minimized)
  const currentBufferSize = typeof LOG_BUFFER_SIZE === 'number' ? LOG_BUFFER_SIZE : 100;
  if (memoryBuffer.length >= currentBufferSize) {
    memoryBuffer.shift(); // Remove oldest entry
  }
  memoryBuffer.push(optimizedEntry);
  
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
    return memoryBuffer.slice(-count);
  },
  getLogFilePath() {
    return logFilePath;
  },
  adjustLogBufferSize
};

