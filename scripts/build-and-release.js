const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
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
execSync('npm run package:squirrel', { stdio: 'inherit' });
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
}

// Create full package
createFullPackage(fullPackagePath);

// Create RELEASES file
const releasesPath = path.join(packagesDir, 'RELEASES');
const releasesContent = createReleasesContent(version, fullPackage, deltaPackage);
fs.writeFileSync(releasesPath, releasesContent);

console.log('Release build completed successfully!');
console.log(`Packages available at: ${packagesDir}`);
console.log(`RELEASES file: ${releasesPath}`);

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
  const buildFiles = fs.readdirSync(buildPath);
  for (const file of buildFiles) {
    const filePath = path.join(buildPath, file);
    if (fs.statSync(filePath).isFile()) {
      zip.addLocalFile(filePath, '');
    }
  }

  // Add RELEASES file
  const releasesPath = path.join(packagesDir, 'RELEASES');
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

// Auto-increment version
function incrementVersion() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const versionParts = packageJson.version.split('.').map(Number);
  versionParts[2]++;
  const newVersion = versionParts.join('.');
  packageJson.version = newVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(`Version updated from ${version} to ${newVersion}`);
  return newVersion;
}

// Create GitHub release
function createGitHubRelease(version) {
  // Create release notes
  const releaseNotes = `
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

  // Create release notes file
  const releaseNotesPath = path.join(__dirname, '..', 'release-notes.md');
  fs.writeFileSync(releaseNotesPath, releaseNotes);

  // Create release
  console.log('Creating GitHub release...');
  execSync(`gh release create v${version} --title "Release v${version}" --notes-file "${releaseNotesPath}"`, { stdio: 'inherit' });

  // Upload artifacts
  const artifacts = [
    `../dist/squirrel-windows/SIPCallerID-Setup-${version}.exe`,
    `../packages/SIPCallerID-${version}-full.nupkg`,
    `../packages/RELEASES`
  ];

  for (const artifact of artifacts) {
    if (fs.existsSync(artifact)) {
      console.log(`Uploading artifact: ${artifact}`);
      execSync(`gh release upload v${version} ${artifact}`, { stdio: 'inherit' });
    }
  }

  console.log('GitHub release created successfully!');
  console.log(`Release: v${version}`);
  console.log(`Release notes: ${releaseNotesPath}`);
}

// Main execution
async function main() {
  // Auto-increment version
  const newVersion = incrementVersion();

  // Build the application
  console.log('Building application...');
  execSync('npm run package:squirrel', { stdio: 'inherit' });

  // Create NuGet packages
  console.log('Creating NuGet packages...');
  const packagesDir = path.join(__dirname, '..', 'packages');
  if (!fs.existsSync(packagesDir)) {
    fs.mkdirSync(packagesDir, { recursive: true });
  }

  // Create full package
  const fullPackage = `SIPCallerID-${newVersion}-full.nupkg`;
  const fullPackagePath = path.join(packagesDir, fullPackage);
  createFullPackage(fullPackagePath);

  // Create RELEASES file
  const releasesPath = path.join(packagesDir, 'RELEASES');
  const releasesContent = createReleasesContent(newVersion, fullPackage, null);
  fs.writeFileSync(releasesPath, releasesContent);

  // Create GitHub release
  createGitHubRelease(newVersion);

  // Commit and push changes
  console.log('Committing and pushing changes...');
  execSync('git add .', { stdio: 'inherit' });
  execSync(`git commit -m "Update version to ${newVersion} and build packages"`, { stdio: 'inherit' });
  execSync('git push origin main', { stdio: 'inherit' });

  console.log('Release process completed successfully!');
}

// Run the main function
main();
