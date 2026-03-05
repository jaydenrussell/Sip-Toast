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
  execSync('node scripts/create-nuget-packages.js', { stdio: 'inherit' });
}

// Step 4: Create GitHub release
function createGitHubRelease(version) {
  const releaseNotes = `SIP Caller ID Release v${version}

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

For more information, see the documentation.`;

  const releaseNotesPath = path.join(__dirname, '..', 'release-notes.md');
  fs.writeFileSync(releaseNotesPath, releaseNotes);

  console.log('Creating GitHub release...');
  execSync(`gh release create v${version} --title "Release v${version}" --notes-file "${releaseNotesPath}"`, { stdio: 'inherit' });

  const artifacts = [
    `dist/squirrel-windows/SIPCallerID-Setup-${version}.exe`,
    `dist/squirrel-windows/SIPCallerID-${version}-full.nupkg`,
    `dist/squirrel-windows/RELEASES`
  ];

  for (const artifact of artifacts) {
    if (fs.existsSync(artifact)) {
      console.log(`Uploading artifact: ${artifact}`);
      try {
        execSync(`gh release upload v${version} ${artifact}`, { stdio: 'inherit' });
      } catch (error) {
        console.error(`Failed to upload ${artifact}: ${error.message}`);
        throw error;
      }
    } else {
      console.warn(`Artifact not found: ${artifact}`);
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

  const newVersion = incrementVersion();
  buildApplication();
  createNuGetPackages(newVersion);
  createGitHubRelease(newVersion);
  commitAndPush(newVersion);

  console.log('================================');
  console.log('Release process completed successfully!');
  console.log(`New version: ${newVersion}`);
  console.log('Release artifacts uploaded to GitHub');
  console.log('Changes committed and pushed to repository');
}

main();