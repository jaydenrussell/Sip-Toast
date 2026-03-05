const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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

// Step 3: Create NuGet packages using existing script
function createNuGetPackages(version) {
  console.log('Creating NuGet packages...');
  // Use the existing create-nuget-packages.js script
  execSync('node scripts/create-nuget-packages.js', { stdio: 'inherit' });
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
