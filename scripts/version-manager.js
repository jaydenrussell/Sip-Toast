const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

console.log('Managing version and creating release...');

// Get current version
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;

// Increment version
const newVersion = incrementVersion(currentVersion);
console.log(`Current version: ${currentVersion}`);
console.log(`New version: ${newVersion}`);

// Update package.json
packageJson.version = newVersion;
packageJson.buildDate = new Date().toISOString();
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

// Build the application
console.log('Building application...');
execSync('npm run package:squirrel', { stdio: 'inherit' });

// Create NuGet packages
console.log('Creating NuGet packages...');
createNuGetPackages(newVersion);

// Create RELEASES file
const packagesDir = path.join(__dirname, '..', 'packages');
const releasesPath = path.join(packagesDir, 'RELEASES');
const releasesContent = createReleasesContent(newVersion);
fs.writeFileSync(releasesPath, releasesContent);

// Create GitHub release
console.log('Creating GitHub release...');
const releaseNotesPath = path.join(__dirname, '..', 'release-notes.md');
const releaseNotes = createReleaseNotes(newVersion);
fs.writeFileSync(releaseNotesPath, releaseNotes);

execSync(`gh release create v${newVersion} --title "Release v${newVersion}" --notes-file "${releaseNotesPath}"`, { stdio: 'inherit' });

// Upload artifacts
const artifacts = [
  `../dist/squirrel-windows/SIPCallerID-Setup-${newVersion}.exe`,
  `../packages/SIPCallerID-${newVersion}-full.nupkg`,
  `../packages/RELEASES`
];

for (const artifact of artifacts) {
  if (fs.existsSync(artifact)) {
    console.log(`Uploading artifact: ${artifact}`);
    execSync(`gh release upload v${newVersion} ${artifact}`, { stdio: 'inherit' });
  }
}

console.log('Release created successfully!');
console.log(`New version: ${newVersion}`);
console.log(`Release: v${newVersion}`);

function incrementVersion(version) {
  const parts = version.split('.');
  const patch = parseInt(parts[2], 10);
  parts[2] = (patch + 1).toString();
  return parts.join('.');
}

function getPreviousVersion(currentVersion) {
  // Get previous version from Git tags
  try {
    const tags = execSync('git tag --sort=-version:refname', { encoding: 'utf8' })
      .split('\n')
      .filter(tag => tag.startsWith('v') && tag !== `v${currentVersion}`);
    return tags[0]?.replace('v', '');
  } catch (error) {
    console.warn('Could not get previous version from Git tags');
    return null;
  }
}

function createNuGetPackages(version) {
  const packagesDir = path.join(__dirname, '..', 'packages');
  if (!fs.existsSync(packagesDir)) {
    fs.mkdirSync(packagesDir, { recursive: true });
  }

  // Create full package
  const fullPackage = `SIPCallerID-${version}-full.nupkg`;
  const fullPackagePath = path.join(packagesDir, fullPackage);
  createFullPackage(fullPackagePath, version);

  // Create delta package if needed
  const previousVersion = getPreviousVersion(version);
  let deltaPackage = null;
  if (previousVersion) {
    deltaPackage = `SIPCallerID-${version}-delta.nupkg`;
    const deltaPackagePath = path.join(packagesDir, deltaPackage);
    createDeltaPackage(deltaPackagePath, previousVersion, version);
  }
}

function createFullPackage(packagePath, version) {
  const zip = new AdmZip();

  // Find the actual setup executable with the correct version
  const squirrelDir = path.join(__dirname, '..', 'dist', 'squirrel-windows');
  if (fs.existsSync(squirrelDir)) {
    const files = fs.readdirSync(squirrelDir);
    const setupExe = files.find(file => file.includes('Setup') && file.includes(version));
    
    if (setupExe) {
      zip.addLocalFile(path.join(squirrelDir, setupExe), 'tools');
      console.log(`Added setup executable: ${setupExe}`);
    } else {
      console.warn(`Setup executable not found for version ${version}`);
    }
  }

  // Add RELEASES file
  const releasesPath = path.join(__dirname, '..', 'packages', 'RELEASES');
  if (fs.existsSync(releasesPath)) {
    zip.addLocalFile(releasesPath, '');
  }

  // Add NuGet package metadata
  const nuspecContent = `
<?xml version="1.0"?>
<package>
  <metadata>
    <id>SIPCallerID</id>
    <version>${version}</version>
    <authors>Jayden Russell</authors>
    <description>SIP Caller ID Application - Full Package</description>
    <summary>SIP Caller ID toast notifications for Windows 11 with Acuity Scheduling integration</summary>
    <tags>sip caller-id windows toast acuity</tags>
  </metadata>
  <files>
    <file src="tools\\*" target="tools" />
    <file src="RELEASES" target="" />
  </files>
</package>
  `.trim();

  zip.addFile('SIPCallerID.nuspec', Buffer.from(nuspecContent));
  zip.writeZip(packagePath);
  console.log(`Created full package: ${packagePath}`);
}

function createDeltaPackage(packagePath, oldVersion, newVersion) {
  const zip = new AdmZip();

  // Find the delta setup executable
  const squirrelDir = path.join(__dirname, '..', 'dist', 'squirrel-windows');
  if (fs.existsSync(squirrelDir)) {
    const files = fs.readdirSync(squirrelDir);
    const setupExe = files.find(file => file.includes('Setup') && file.includes(newVersion));
    
    if (setupExe) {
      zip.addLocalFile(path.join(squirrelDir, setupExe), 'tools');
      console.log(`Added delta setup executable: ${setupExe}`);
    }
  }

  // Add RELEASES file
  const releasesPath = path.join(__dirname, '..', 'packages', 'RELEASES');
  if (fs.existsSync(releasesPath)) {
    zip.addLocalFile(releasesPath, '');
  }

  // Add NuGet package metadata
  const nuspecContent = `
<?xml version="1.0"?>
<package>
  <metadata>
    <id>SIPCallerID</id>
    <version>${newVersion}</version>
    <authors>Jayden Russell</authors>
    <description>SIP Caller ID Application - Delta Package</description>
    <summary>Delta update package for SIP Caller ID</summary>
    <tags>sip caller-id windows toast acuity delta</tags>
  </metadata>
  <files>
    <file src="tools\\*" target="tools" />
    <file src="RELEASES" target="" />
  </files>
</package>
  `.trim();

  zip.addFile('SIPCallerID.nuspec', Buffer.from(nuspecContent));
  zip.writeZip(packagePath);
  console.log(`Created delta package: ${packagePath}`);
}

function createReleasesContent(version) {
  const packagesDir = path.join(__dirname, '..', 'packages');
  const content = [];
  
  // Add full package
  const fullPackage = `SIPCallerID-${version}-full.nupkg`;
  const fullPackagePath = path.join(packagesDir, fullPackage);
  if (fs.existsSync(fullPackagePath)) {
    const fullPackageSize = fs.statSync(fullPackagePath).size;
    content.push(`${version}|${fullPackage}|${fullPackageSize}|${getChecksum(fullPackagePath)}`);
  }

  // Add delta package if it exists
  const deltaPackage = `SIPCallerID-${version}-delta.nupkg`;
  const deltaPackagePath = path.join(packagesDir, deltaPackage);
  if (fs.existsSync(deltaPackagePath)) {
    const deltaPackageSize = fs.statSync(deltaPackagePath).size;
    content.push(`${version}|${deltaPackage}|${deltaPackageSize}|${getChecksum(deltaPackagePath)}`);
  }

  return content.join('\n');
}

function getChecksum(filePath) {
  // Simple checksum implementation
  const crypto = require('crypto');
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha1').update(content).digest('hex').substring(0, 10);
}

function createReleaseNotes(version) {
  return `
# SIP Caller ID Release v${version}

This release includes:
- Complete update installer with seamless update flow
- Modern UI with progress tracking
- Automatic application restart after updates
- Full and delta NuGet packages
- RELEASES file for Squirrel.Windows

## Installation
1. Download the latest setup package
2. Run the installer
3. Application will auto-update in the future

## Release artifacts
- SIPCallerID-Setup-${version}.exe (Setup package)
- SIPCallerID-${version}-full.nupkg (Full NuGet package)
- SIPCallerID-${version}-delta.nupkg (Delta NuGet package, if available)
- RELEASES (Release manifest)

## Changes
- Auto-incrementing version management
- Improved NuGet package creation with executable inclusion
- Full and delta package support
- Enhanced release automation

For more information, see the documentation.
`;
}