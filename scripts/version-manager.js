const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Get current version
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const currentVersion = packageJson.version;

// Increment version based on strategy
const incrementVersion = (version) => {
  const parts = version.split('.');
  const patch = parseInt(parts[2], 10);
  return `${parts[0]}.${parts[1]}.${patch + 1}`;
};

// Get previous version from Git tags
const getPreviousVersion = (currentVersion) => {
  try {
    const tags = execSync('git tag --sort=-version:refname', { encoding: 'utf8' })
      .split('\n')
      .filter(tag => tag.startsWith('v') && /^\d+\.\d+\.\d+$/.test(tag.substring(1)));
    
    if (tags.length > 0) {
      return tags[0].substring(1);
    }
  } catch (error) {
    console.warn('Could not get previous version from Git tags');
    return null;
  }
};

// Create releases content for NuGet packages
const createReleasesContent = (version, fullPackage, deltaPackage) => {
  const content = [];
  const fullPackageSize = fs.statSync(fullPackage).size;
  content.push(`${version}|${fullPackage}|${fullPackageSize}|1234567890`);
  if (deltaPackage) {
    const deltaPackageSize = fs.statSync(deltaPackage).size;
    content.push(`${version}|${deltaPackage}|${deltaPackageSize}|1234567891`);
  }
  return content.join('\n');
};

// Create release notes
const createReleaseNotes = (version) => {
  return `
SIP Caller ID Release v${version}

Release artifacts:
- SIPCallerID-Setup-${version}.exe (Setup package)
- SIPCallerID-${version}-full.nupkg (Full NuGet package)
- RELEASES (Release manifest)
`;
};

// Main version management function
const manageVersion = async () => {
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

  // Commit the version change
  try {
    execSync(`git add package.json`, { stdio: 'inherit' });
    execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
    console.log(`📝 Committed version change`);
  } catch (error) {
    console.error(`❌ Error committing version change: ${error.message}`);
    process.exit(1);
  }

// Rebuild with new version
  console.log(`🔨 Rebuilding with version ${newVersion}...`);
  try {
    // Use the comprehensive build script that creates actual packages
    execSync('npm run build-and-release', { stdio: 'inherit' });
    console.log(`✅ Build complete for version ${newVersion}`);
  } catch (error) {
    console.error(`❌ Build failed: ${error.message}`);
    process.exit(1);
  }

  console.log('Release created successfully!');
  console.log(`New version: ${newVersion}`);
  console.log(`Release: v${newVersion}`);
};

// Export functions for use in other scripts
module.exports = {
  incrementVersion,
  getPreviousVersion,
  createReleasesContent,
  createReleaseNotes,
  manageVersion
};

// Run if this script is executed directly
if (require.main === module) {
  manageVersion();
}