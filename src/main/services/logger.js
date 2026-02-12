const { app } = require('electron');
const { createLogger, format, transports } = require('winston');
const path = require('path');
const os = require('os');
const fs = require('fs');
const EventEmitter = require('events');

// Reduced log buffer size for memory efficiency
const LOG_BUFFER_SIZE = 50; // 50 entries ~25KB (reduced from 100)
const LOG_BUFFER_SIZE_MINIMIZED = 25; // 25 entries ~12KB when minimized
const logEmitter = new EventEmitter();
const memoryBuffer = [];

// Function to adjust log buffer size based on window visibility
const adjustLogBufferSize = (isMinimized) => {
  const targetSize = isMinimized ? LOG_BUFFER_SIZE_MINIMIZED : LOG_BUFFER_SIZE;
  if (memoryBuffer.length > targetSize) {
    memoryBuffer.splice(0, memoryBuffer.length - targetSize);
  }
};

const resolveLogDirectory = () => {
  try {
    if (app?.getPath) {
      return path.join(app.getPath('userData'), 'logs');
    }
  } catch { /* Fallback below */ }
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
      maxsize: 1024 * 1024, // Reduced to 1MB
      maxFiles: 3, // Reduced from 5
      tailable: true
    })
  ]
});

// Optimized sanitization - reduced regex complexity
const sensitivePatterns = [
  /password\s*[:=]\s*['"]?[^'",\s]+['"]?/gi,
  /api[_-]?key\s*[:=]\s*['"]?[^'",\s]+['"]?/gi,
  /apiKey\s*[:=]\s*['"]?[^'",\s]+['"]?/gi,
  /auth[_-]?token\s*[:=]\s*['"]?[^'",\s]+['"]?/gi,
  /secret\s*[:=]\s*['"]?[^'",\s]+['"]?/gi,
  /userId\s*[:=]\s*['"]?[^'",\s]+['"]?/gi
];

const sanitizeMessage = (message) => {
  const msg = typeof message === 'string' ? message : String(message);
  let result = msg;
  for (const pattern of sensitivePatterns) {
    result = result.replace(pattern, (match) => `${match.split(/[:=]/)[0]}=[REDACTED]`);
  }
  return result;
};

const pushToBuffer = (entry) => {
  const sanitizedMessage = sanitizeMessage(entry.message);
  const optimizedEntry = {
    level: entry.level,
    message: sanitizedMessage.length > 300 
      ? sanitizedMessage.substring(0, 300) + '...' 
      : sanitizedMessage,
    timestamp: entry.timestamp
  };
  
  const currentBufferSize = LOG_BUFFER_SIZE;
  if (memoryBuffer.length >= currentBufferSize) {
    memoryBuffer.shift();
  }
  memoryBuffer.push(optimizedEntry);
  
  logEmitter.emit('entry', { ...entry, message: sanitizeMessage(entry.message) });
};

const originalLog = loggerInstance.log.bind(loggerInstance);
loggerInstance.log = (level, message, ...meta) => {
  const payload = typeof level === 'object' 
    ? level 
    : { level, message, meta };
  
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
  return originalLog({ ...payload, message: sanitizedMessage });
};

module.exports = {
  logger: loggerInstance,
  logEmitter,
  getRecentLogs(count = 50) { // Default to 50 instead of 100
    return memoryBuffer.slice(-count);
  },
  getLogFilePath() {
    return logFilePath;
  },
  adjustLogBufferSize
};
