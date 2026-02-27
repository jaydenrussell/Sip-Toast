const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Creating GitHub release...');

// Get current version
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

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