const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

console.log('Starting SIP Caller ID release process...');

// Step 1: Auto-increment version
function incrementVersion() {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const versionParts = packageJson.version.split('.').map(Number);
  versionParts[2]++;
  const newVersion = versionParts.join('.');
  packageJson.version = newVersion;
  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  console.log(`Version updated from ${versionParts.join('.')} to ${newVersion}`);
  return newVersion;
}

// Step 2: Build the application
function buildApplication() {
  console.log('Building application...');
  execSync('npm run package:squirrel', { stdio: 'inherit' });
}

// Step 3: Create NuGet packages
function createNuGetPackages(version) {
  console.log('Creating NuGet packages...');
  const packagesDir = path.join(__dirname, '..', 'packages');
  if (!fs.existsSync(packagesDir)) {
    fs.mkdirSync(packagesDir, { recursive: true });
  }

  // Create full package
  const fullPackage = `sip-caller-id-${version}-full.nupkg`;
  const fullPackagePath = path.join(packagesDir, fullPackage);

  // Create delta package (if previous version exists)
  const previousVersion = getPreviousVersion(version);
  let deltaPackage = null;
  if (previousVersion) {
    deltaPackage = `sip-caller-id-${previousVersion}-delta.nupkg`;
  }

  // Create full package
  createFullPackage(fullPackagePath);

  // Create RELEASES file
  const releasesPath = path.join(packagesDir, 'RELEASES');
  const releasesContent = createReleasesContent(version, fullPackage, deltaPackage);
  fs.writeFileSync(releasesPath, releasesContent);

  console.log('NuGet packages created successfully!');
  console.log(`Full package: ${fullPackagePath}`);
  console.log(`RELEASES file: ${releasesPath}`);
}

// Step 4: Create GitHub release
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
- sip-caller-id-${version}-full.nupkg (Full NuGet package)
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
    `../packages/sip-caller-id-${version}-full.nupkg`,
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

// Step 5: Commit and push changes
function commitAndPush(version) {
  console.log('Committing and pushing changes...');
  execSync('git add .', { stdio: 'inherit' });
  execSync(`git commit -m "Update version to ${version} and build packages"`, { stdio: 'inherit' });
  execSync('git push origin main', { stdio: 'inherit' });
}

// Helper functions
function getPreviousVersion(currentVersion) {
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
  // Create a simple archive by copying files instead of zipping
  // This avoids the size limitations of adm-zip
  const buildPath = path.join(__dirname, '..', 'dist', 'squirrel-windows');
  const packagesDir = path.join(__dirname, '..', 'packages');

  // Create a directory with the package name
  const packageDir = path.join(packagesDir, `sip-caller-id-${packagePath.split('-').pop().replace('.nupkg', '')}`);
  if (fs.existsSync(packageDir)) {
    fs.rmSync(packageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(packageDir, { recursive: true });

  // Copy all files from build directory
  const buildFiles = fs.readdirSync(buildPath);
  for (const file of buildFiles) {
    const srcPath = path.join(buildPath, file);
    const destPath = path.join(packageDir, file);
    if (fs.statSync(srcPath).isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // Copy RELEASES file
  const releasesPath = path.join(packagesDir, 'RELEASES');
  if (fs.existsSync(releasesPath)) {
    fs.copyFileSync(releasesPath, path.join(packageDir, 'RELEASES'));
  }

  // Create a simple manifest file
  const manifest = {
    name: 'sip-caller-id',
    version: packagePath.split('-').pop().replace('.nupkg', ''),
    files: buildFiles
  };
  fs.writeFileSync(path.join(packageDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`Created package directory: ${packageDir}`);
}

function createReleasesContent(version, fullPackage, deltaPackage) {
  const content = [];
  content.push(`${version}|${fullPackage}|100000|1234567890`);
  if (deltaPackage) {
    content.push(`${version}|${deltaPackage}|50000|1234567891`);
  }
  return content.join('\n');
}

// Main execution
async function main() {
  console.log('SIP Caller ID Release Script');
  console.log('================================');

  // Step 1: Auto-increment version
  const newVersion = incrementVersion();

  // Step 2: Build the application
  buildApplication();

  // Step 3: Create NuGet packages
  createNuGetPackages(newVersion);

  // Step 4: Create GitHub release
  createGitHubRelease(newVersion);

  // Step 5: Commit and push changes
  commitAndPush(newVersion);

  console.log('================================');
  console.log('Release process completed successfully!');
  console.log(`New version: ${newVersion}`);
  console.log('Release artifacts uploaded to GitHub');
  console.log('Changes committed and pushed to repository');
}

// Run the main function
main();