const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building update installer...');

// Clean dist directory
const distPath = path.join(__dirname, 'dist');
if (fs.existsSync(distPath)) {
  execSync(`rm -rf ${distPath}`, { stdio: 'inherit' });
}

// Install dependencies
console.log('Installing dependencies...');
execSync('npm install', { stdio: 'inherit' });

// Build the application
console.log('Building application...');
execSync('npm run build', { stdio: 'inherit' });

// Copy icon
const iconPath = path.join(__dirname, 'build', 'icon.ico');
if (fs.existsSync(iconPath)) {
  const targetPath = path.join(distPath, 'win-unpacked', 'icon.ico');
  if (!fs.existsSync(path.dirname(targetPath))) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  }
  fs.copyFileSync(iconPath, targetPath);
  console.log('Icon copied successfully');
}

console.log('Build completed successfully!');
console.log(`Installer available at: ${path.join(distPath, 'win-unpacked', 'sip-toast-update-installer.exe')}`);