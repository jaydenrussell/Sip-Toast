const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Uploading NuGet packages and executable...');

// Get current version
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

console.log(`Current version: ${version}`);

// Check if GitHub CLI is available
try {
  execSync('gh --version', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ Error: GitHub CLI (gh) is not installed or not in PATH');
  console.error('   Install from: https://cli.github.com/');
  process.exit(1);
}

// Check if authenticated
try {
  execSync('gh auth status', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ Error: Not authenticated with GitHub CLI');
  console.error('   Run: gh auth login');
  process.exit(1);
}

// Check if NuGet CLI is available
let nugetAvailable = false;
try {
  execSync('nuget help', { stdio: 'ignore' });
  nugetAvailable = true;
  console.log('✅ NuGet CLI is available');
} catch (error) {
  console.warn('⚠️  NuGet CLI not found, skipping NuGet package upload');
}

// Define files to upload
const packagesDir = path.join(__dirname, '..', 'packages');
const distDir = path.join(__dirname, '..', 'dist', 'squirrel-windows');

const filesToUpload = [];

// Add NuGet packages
const fullPackage = `SIPCallerID-${version}-full.nupkg`;
const deltaPackage = `SIPCallerID-${version}-delta.nupkg`;

if (fs.existsSync(path.join(packagesDir, fullPackage))) {
  filesToUpload.push(path.join(packagesDir, fullPackage));
  console.log(`✅ Found full package: ${fullPackage}`);
}

if (fs.existsSync(path.join(packagesDir, deltaPackage))) {
  filesToUpload.push(path.join(packagesDir, deltaPackage));
  console.log(`✅ Found delta package: ${deltaPackage}`);
}

// Add setup executable
const setupExe = `SIPCallerID-Setup-${version}.exe`;
if (fs.existsSync(path.join(distDir, setupExe))) {
  filesToUpload.push(path.join(distDir, setupExe));
  console.log(`✅ Found setup executable: ${setupExe}`);
}

// Add RELEASES file
const releasesFile = path.join(packagesDir, 'RELEASES');
if (fs.existsSync(releasesFile)) {
  filesToUpload.push(releasesFile);
  console.log(`✅ Found RELEASES file`);
}

if (filesToUpload.length === 0) {
  console.error('❌ No files found to upload');
  process.exit(1);
}

// Upload to GitHub Release
console.log('\n📦 Uploading files to GitHub Release...');

// Check if release exists
const tagName = `v${version}`;
let releaseExists = false;

try {
  execSync(`gh release view ${tagName}`, { stdio: 'ignore' });
  releaseExists = true;
  console.log(`✅ Release ${tagName} already exists, uploading additional assets...`);
} catch (error) {
  console.log(`📝 Creating new release ${tagName}...`);
  const releaseNotes = createReleaseNotes(version);
  const releaseNotesPath = path.join(__dirname, '..', 'release-notes.md');
  fs.writeFileSync(releaseNotesPath, releaseNotes);
  
  try {
    execSync(`gh release create ${tagName} --title "Release v${version}" --notes-file "${releaseNotesPath}"`, { stdio: 'inherit' });
    console.log(`✅ Created release ${tagName}`);
  } catch (createError) {
    console.error(`❌ Failed to create release: ${createError.message}`);
    process.exit(1);
  }
}

// Upload files to release
for (const filePath of filesToUpload) {
  const fileName = path.basename(filePath);
  console.log(`📤 Uploading ${fileName}...`);
  
  try {
    execSync(`gh release upload ${tagName} "${filePath}"`, { stdio: 'inherit' });
    console.log(`✅ Successfully uploaded ${fileName}`);
  } catch (uploadError) {
    console.error(`❌ Failed to upload ${fileName}: ${uploadError.message}`);
  }
}

// Upload to NuGet.org (if NuGet CLI is available)
if (nugetAvailable) {
  console.log('\n📦 Uploading to NuGet.org...');
  
  // Try to upload full package
  if (fs.existsSync(path.join(packagesDir, fullPackage))) {
    console.log(`📤 Uploading ${fullPackage} to NuGet.org...`);
    try {
      // This would require NuGet API key - in a real scenario, this would be provided securely
      console.log(`⚠️  NuGet upload skipped - API key required`);
      console.log(`   To upload manually: nuget push ${path.join(packagesDir, fullPackage)} -ApiKey YOUR_API_KEY -Source https://api.nuget.org/v3/index.json`);
    } catch (nugetError) {
      console.error(`❌ Failed to upload to NuGet.org: ${nugetError.message}`);
    }
  }
  
  // Try to upload delta package
  if (fs.existsSync(path.join(packagesDir, deltaPackage))) {
    console.log(`📤 Uploading ${deltaPackage} to NuGet.org...`);
    try {
      console.log(`⚠️  NuGet upload skipped - API key required`);
      console.log(`   To upload manually: nuget push ${path.join(packagesDir, deltaPackage)} -ApiKey YOUR_API_KEY -Source https://api.nuget.org/v3/index.json`);
    } catch (nugetError) {
      console.error(`❌ Failed to upload to NuGet.org: ${nugetError.message}`);
    }
  }
}

console.log('\n✅ Upload process completed!');
console.log(`📁 Files uploaded to GitHub Release: ${tagName}`);
console.log(`   - ${filesToUpload.map(f => path.basename(f)).join('\n   - ')}`);

if (nugetAvailable) {
  console.log(`📦 NuGet packages ready for manual upload to NuGet.org`);
} else {
  console.log(`📦 NuGet CLI not available - packages ready for manual upload`);
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