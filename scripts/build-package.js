const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Suppress deprecation warnings
process.env.ELECTRON_BUILDER_HIDE_DEPRECATED_WARNINGS = '1';

console.log('Building package...');

try {
  // Build the application
  execSync('npm run package:squirrel', { stdio: 'inherit' });
  
  // Create NuGet packages
  const createNugetScript = path.join(__dirname, 'create-nuget-packages.js');
  if (fs.existsSync(createNugetScript)) {
    execSync(`node ${createNugetScript}`, { stdio: 'inherit' });
  }
  
  console.log('Package built successfully!');
} catch (error) {
  console.error('Build failed:', error.message);
  process.exit(1);
}