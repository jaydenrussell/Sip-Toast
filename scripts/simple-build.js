const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building SIP Caller ID release...');

// Clean build directory
const buildPath = path.join(__dirname, '..', 'build');
if (!fs.existsSync(buildPath)) {
  fs.mkdirSync(buildPath, { recursive: true });
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

// Create full package using simple zip approach
const zip = require('adm-zip');
const fullZip = new zip();

// Add all files from build directory
const buildFiles = fs.readdirSync(buildPath);
for (const file of buildFiles) {
  const filePath = path.join(buildPath, file);
  if (fs.statSync(filePath).isFile()) {
    fullZip.addLocalFile(filePath, '');
  }
}

// Add RELEASES file
const releasesPath = path.join(packagesDir, 'RELEASES');
if (fs.existsSync(releasesPath)) {
  fullZip.addLocalFile(releasesPath, '');
}

// Save the package
fullZip.writeZip(fullPackagePath);
console.log(`Created full package: ${fullPackagePath}`);

// Create RELEASES file
const releasesContent = `${version}|${fullPackage}|100000|1234567890}`;
fs.writeFileSync(releasesPath, releasesContent);

console.log('Release build completed successfully!');
console.log(`Packages available at: ${packagesDir}`);
console.log(`RELEASES file: ${releasesPath}`);
