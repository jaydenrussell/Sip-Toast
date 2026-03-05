const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { execSync } = require('child_process');
console.log('Creating NuGet packages...');

// Get current version
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

// Create packages directory
const packagesDir = path.join(__dirname, '..', 'packages');
if (!fs.existsSync(packagesDir)) {
  fs.mkdirSync(packagesDir, { recursive: true });
}

// Create full package
const fullPackage = `SIPCallerID-${version}-full.nupkg`;
const fullPackagePath = path.join(packagesDir, fullPackage);

// Create full package only (delta packages removed)
createFullPackage(fullPackagePath);

// Create RELEASES file
const releasesPath = path.join(packagesDir, 'RELEASES');
const releasesContent = createReleasesContent(version, fullPackage);
fs.writeFileSync(releasesPath, releasesContent);

console.log('NuGet packages created successfully!');
console.log(`Full package: ${fullPackagePath}`);

function getPreviousVersion(currentVersion) {
  // Get previous version from Git tags
  try {
    const tags = execSync('git tag --sort=-version:refname', { encoding: 'utf8' })
      .split('\n')
      .filter(tag => tag.startsWith('v') && tag !== `v${currentVersion}`);
    return tags[0]?.replace('v', '');
  } catch (error) {
    console.warn('Could not get previous version from Git tags');
    // Try to get tags from GitHub API as fallback
    try {
      const response = execSync('gh api repos/jaydenrussell/Sip-Toast/tags', { encoding: 'utf8' });
      const tags = JSON.parse(response);
      const filteredTags = tags.filter(tag => tag.name.startsWith('v') && tag.name !== `v${currentVersion}`);
      return filteredTags[0]?.name.replace('v', '');
    } catch (apiError) {
      console.warn('Could not get previous version from GitHub API');
      // Try to get tags from GitHub API with authentication
      try {
        const response = execSync('gh api repos/jaydenrussell/Sip-Toast/tags --header "Accept: application/vnd.github.v3+json"', { encoding: 'utf8' });
        const tags = JSON.parse(response);
        const filteredTags = tags.filter(tag => tag.name.startsWith('v') && tag.name !== `v${currentVersion}`);
        return filteredTags[0]?.name.replace('v', '');
      } catch (authError) {
        console.warn('Could not get previous version from GitHub API with authentication');
        return null;
      }
    }
  }
}

function createFullPackage(packagePath) {
  const zip = new AdmZip();

  // Create the NuGet package structure
  const squirrelPackagePath = path.join(__dirname, '..', 'dist', 'squirrel-windows', 'SIPCallerID-Setup-0.72.118.exe');
  if (fs.existsSync(squirrelPackagePath)) {
    zip.addLocalFile(squirrelPackagePath, 'tools');
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
        <description>SIP Caller ID Application</description>
      </metadata>
      <files>
        <file src="tools\\SIPCallerID-Setup-0.72.118.exe" target="tools" />
        <file src="RELEASES" target="" />
      </files>
    </package>
  `.trim();

  zip.addFile('SIPCallerID.nuspec', Buffer.from(nuspecContent));
  zip.writeZip(packagePath);
  console.log(`Created full package: ${packagePath}`);
}

function createDeltaPackage(packageName, oldVersion, newVersion) {
  const zip = new AdmZip();

  // Get the old and new package paths
  const oldPackagePath = path.join(__dirname, '..', 'packages', `SIPCallerID-${oldVersion}-full.nupkg`);
  const newPackagePath = path.join(__dirname, '..', 'packages', `SIPCallerID-${newVersion}-full.nupkg`);

  // Create delta package structure
  zip.addLocalFile(path.join(__dirname, '..', 'dist', 'squirrel-windows', 'SIPCallerID-Setup-0.72.117.exe'), 'tools');
  zip.addLocalFile(path.join(__dirname, '..', 'packages', 'RELEASES'), '');

  // Add NuGet package metadata
  const nuspecContent = `
    <?xml version="1.0"?>
    <package>
      <metadata>
        <id>SIPCallerID</id>
        <version>${newVersion}</version>
        <authors>Jayden Russell</authors>
        <description>SIP Caller ID Application Delta Package</description>
      </metadata>
      <files>
        <file src="tools\\SIPCallerID-Setup-0.72.117.exe" target="tools" />
        <file src="RELEASES" target="" />
      </files>
    </package>
  `.trim();

  zip.addFile('SIPCallerID.nuspec', Buffer.from(nuspecContent));
  zip.writeZip(packageName);
  console.log(`Created delta package: ${packageName}`);
}

function createReleasesContent(version, fullPackage) {
  const content = [];
  const fullPackagePath = path.join(__dirname, '..', 'packages', fullPackage);
  const fullPackageSize = fs.statSync(fullPackagePath).size;
  content.push(`${version}|${fullPackage}|${fullPackageSize}|1234567890`);
  return content.join('\n');
}
