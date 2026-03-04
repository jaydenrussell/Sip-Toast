const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const logDir = path.join(os.homedir(), 'AppData', 'Roaming', 'sip-toast', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFilePath = path.join(logDir, 'sip-toast.log');

const loggerInstance = {
  info: (message) => log('info', message),
  warn: (message) => log('warn', message),
  error: (message) => log('error', message),
  debug: (message) => log('debug', message)
};

const log = (level, message) => {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] [${level}] ${message}\n`;
  console.log(logEntry.trim());
  if (level !== 'debug') {
    try {
      fs.appendFileSync(logFilePath, logEntry);
    } catch (e) {
      // Ignore file write errors
    }
  }
  return true;
};

// Function to adjust log buffer size based on window visibility
const adjustLogBufferSize = (isMinimized) => {
  // This is a placeholder - the actual implementation would adjust buffer size
  // For now, we'll just log the request
  console.log(`adjustLogBufferSize called with isMinimized: ${isMinimized}`);
};

module.exports = {
  logger: loggerInstance,
  getLogFilePath: () => logFilePath,
  adjustLogBufferSize
};
