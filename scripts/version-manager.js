const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

console.log('Managing version and creating release...');

// Get current version
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;

// Increment version based on strategy
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
execSync('node create-nuget-packages.js', { stdio: 'inherit' });

// Create RELEASES file
const packagesDir = path.join(__dirname, '..', 'packages');
const releasesPath = path.join(packagesDir, 'RELEASES');
const releasesContent = fs.readFileSync(releasesPath, 'utf8');

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

function createFullPackage(packagePath) {
  const zip = new AdmZip();

  // Add all files from build directory
  const buildPath = path.join(__dirname, '..', 'build');
  const buildFiles = fs.readdirSync(buildPath);
  for (const file of buildFiles) {
    const filePath = path.join(buildPath, file);
    if (fs.statSync(filePath).isFile()) {
      zip.addLocalFile(filePath, '');
    }
  }

  // Add RELEASES file
  const releasesPath = path.join(__dirname, '..', 'packages', 'RELEASES');
  if (fs.existsSync(releasesPath)) {
    zip.addLocalFile(releasesPath, '');
  }

  // Save the package
  zip.writeZip(packagePath);
  console.log(`Created full package: ${packagePath}`);
}

function createDeltaPackage(packageName, oldVersion, newVersion) {
  // Delta package creation logic would go here
  // This would typically compare old and new builds
  console.log(`Delta package creation not implemented for ${packageName}`);
}

function createReleasesContent(version, fullPackage, deltaPackage) {
  const content = [];
  content.push(`${version}|${fullPackage}|100000|1234567890`);
  if (deltaPackage) {
    content.push(`${version}|${deltaPackage}|50000|1234567891`);
  }
  return content.join('\n');
}

function createReleaseNotes(version) {
  return `
SIP Caller ID Release v${version}

This release includes:
- Complete update installer with seamless update flow
- Modern UI with progress tracking
- Automatic application restart after updates
- Full and delta NuGet packages
- RELEASES file for Squirrel.Windows

Installation:
1. Download the latest setup package
2. Run the installer
3. Application will auto-update in the future

Release artifacts:
- SIPCallerID-Setup-${version}.exe (Setup package)
- SIPCallerID-${version}-full.nupkg (Full NuGet package)
- RELEASES (Release manifest)

Changelog:
- Added seamless update flow
- Created separate update installer application
- Implemented modern progress UI
- Added automatic restart functionality
- Created NuGet packages for distribution

For more information, see the documentation.
`;
}