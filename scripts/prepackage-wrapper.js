// Wrapper script that ensures increment-version.js runs and logs output
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '..', 'build-log.txt');
const incrementScript = path.join(__dirname, 'increment-version.js');

// Write timestamp to log
const log = (message) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logFile, logMessage, 'utf8');
  console.log(message);
};

log('🚀 Starting prepackage script...');

// Run increment-version.js
const child = spawn('node', [incrementScript], {
  cwd: path.join(__dirname, '..'),
  stdio: ['inherit', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (data) => {
  const output = data.toString();
  stdout += output;
  log(`STDOUT: ${output.trim()}`);
});

child.stderr.on('data', (data) => {
  const output = data.toString();
  stderr += output;
  log(`STDERR: ${output.trim()}`);
});

child.on('close', (code) => {
  if (code === 0) {
    log('✅ Version increment completed successfully');
    
    // Verify version was updated
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    log(`📦 Current version: ${packageJson.version}`);
    log(`📅 Build date: ${packageJson.buildDate}`);
  } else {
    log(`❌ Version increment failed with exit code ${code}`);
    if (stderr) {
      log(`Error output: ${stderr}`);
    }
    process.exit(code);
  }
  
  process.exit(0);
});

child.on('error', (error) => {
  log(`❌ Failed to spawn increment-version.js: ${error.message}`);
  process.exit(1);
});
