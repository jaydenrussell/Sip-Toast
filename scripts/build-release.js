const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building SIP Caller ID release...');

// Clean build directory
const buildPath = path.join(__dirname, '..', 'build');
if (fs.existsSync(buildPath)) {
  // Use Windows-compatible command
  if (process.platform === 'win32') {
    execSync(`rmdir /s /q "${buildPath}"`, { stdio: 'inherit' });
  } else {
    execSync(`rm -rf ${buildPath}`, { stdio: 'inherit' });
  }
}

// Install dependencies
console.log('Installing dependencies...');
execSync('npm install', { stdio: 'inherit' });

// Build the application
console.log('Building application...');
execSync('npm run package:squirrel', { stdio: 'inherit' });

// Create NuGet packages using the version manager
console.log('Creating NuGet packages...');
execSync('node scripts/version-manager.js', { stdio: 'inherit' });

console.log('Release build completed successfully!');
console.log('Use: npm run release to create a GitHub release');