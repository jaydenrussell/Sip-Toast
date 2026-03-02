const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building SIP Caller ID release...');

// Clean build directory
const buildPath = path.join(__dirname, '..', 'build');
if (fs.existsSync(buildPath)) {
  execSync(`rm -rf ${buildPath}`, { stdio: 'inherit' });
}

// Install dependencies
console.log('Installing dependencies...');
execSync('npm install', { stdio: 'inherit' });

// Build the application
console.log('Building application...');
execSync('npm run build', { stdio: 'inherit' });

// Create NuGet packages
console.log('Creating NuGet packages...');
const packagesDir = path.join(__dirname, '..', 'packages');
if (!fs.existsSync(packagesDir)) {
  fs.mkdirSync(packagesDir, { recursive: true });
}

// Get current version
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

// Create full package
const fullPackage = `SIPCallerID-${version}-full.nupkg`;
const fullPackagePath = path.join(packagesDir, fullPackage);

// Create delta package (if previous version exists)
const previousVersion = getPreviousVersion(version);
let deltaPackage = null;
if (previousVersion) {
  deltaPackage = `SIPCallerID-${previousVersion}-delta.nupkg`;
  const deltaPackagePath = path.join(packagesDir, deltaPackage);
  // Create delta package logic here
}

// Create RELEASES file
const releasesPath = path.join(packagesDir, 'RELEASES');
const releasesContent = createReleasesContent(version, fullPackage, deltaPackage);
fs.writeFileSync(releasesPath, releasesContent);

console.log('Release build completed successfully!');
console.log(`Packages available at: ${packagesDir}`);
console.log(`RELEASES file: ${releasesPath}`);

function getPreviousVersion(currentVersion) {
  // Logic to get previous version for delta package
  // This would typically check Git tags or previous builds
  return null; // For now, return null
}

function createReleasesContent(version, fullPackage, deltaPackage) {
  const content = [];
  content.push(`${version}|${fullPackage}|100000|1234567890`);
  if (deltaPackage) {
    content.push(`${version}|${deltaPackage}|50000|1234567891`);
  }
  return content.join('\n');
}