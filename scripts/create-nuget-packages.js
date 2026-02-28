const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const AdmZip = require('adm-zip');

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

// Create delta package (if previous version exists)
const previousVersion = getPreviousVersion(version);
let deltaPackage = null;
if (previousVersion) {
  deltaPackage = `SIPCallerID-${version}-delta.nupkg`;
  
  // Check if the previous version setup executable exists
  const prevSetupPath1 = path.join(__dirname, '..', 'dist', 'squirrel-windows', `SIPCallerID-Setup-${previousVersion}.exe`);
  const prevSetupPath2 = path.join(__dirname, '..', 'dist', 'squirrel-windows', `SIPCallerID-Setup-${previousVersion.replace('1.00.', '1.0.')}.exe`);
  
  if (fs.existsSync(prevSetupPath1) || fs.existsSync(prevSetupPath2)) {
    const deltaPackagePath = path.join(packagesDir, deltaPackage);
    createDeltaPackage(deltaPackagePath, previousVersion, version);
  } else {
    console.log(`Previous version setup executable not found, skipping delta package creation`);
    deltaPackage = null;
  }
} else {
  console.log(`No previous version found, skipping delta package creation`);
}

// Create full package
createFullPackage(fullPackagePath);

// Create RELEASES file
const releasesPath = path.join(packagesDir, 'RELEASES');
const releasesContent = createReleasesContent(version, fullPackage, deltaPackage);
fs.writeFileSync(releasesPath, releasesContent);

console.log('NuGet packages created successfully!');
console.log(`Full package: ${fullPackagePath}`);
if (deltaPackage) {
  console.log(`Delta package: ${deltaPackage}`);
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
  // Try both version formats: "1.00.2" and "1.0.2"
  const squirrelPackagePath1 = path.join(__dirname, '..', 'dist', 'squirrel-windows', `SIPCallerID-Setup-${version}.exe`);
  const squirrelPackagePath2 = path.join(__dirname, '..', 'dist', 'squirrel-windows', `SIPCallerID-Setup-${version.replace('1.00.', '1.0.')}.exe`);
  
  let squirrelPackagePath = null;
  if (fs.existsSync(squirrelPackagePath1)) {
    squirrelPackagePath = squirrelPackagePath1;
  } else if (fs.existsSync(squirrelPackagePath2)) {
    squirrelPackagePath = squirrelPackagePath2;
  }

  if (squirrelPackagePath) {
    zip.addLocalFile(squirrelPackagePath, 'tools');
  } else {
    console.warn(`Warning: Could not find setup executable for version ${version}`);
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
        <file src="tools\\SIPCallerID-Setup-${version.replace('1.00.', '1.0.')}.exe" target="tools" />
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

  // Create delta package structure
  const squirrelPackagePath = path.join(__dirname, '..', 'dist', 'squirrel-windows', `SIPCallerID-Setup-${oldVersion}.exe`);
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
        <version>${newVersion}</version>
        <authors>Jayden Russell</authors>
        <description>SIP Caller ID Application Delta Package</description>
      </metadata>
      <files>
        <file src="tools\\SIPCallerID-Setup-${oldVersion}.exe" target="tools" />
        <file src="RELEASES" target="" />
      </files>
    </package>
  `.trim();

  zip.addFile('SIPCallerID.nuspec', Buffer.from(nuspecContent));
  zip.writeZip(packageName);
  console.log(`Created delta package: ${packageName}`);
}

function createReleasesContent(version, fullPackage, deltaPackage) {
  const content = [];
  const fullPackagePath = path.join(__dirname, '..', 'packages', fullPackage);
  const fullPackageSize = fs.statSync(fullPackagePath).size;
  content.push(`${version}|${fullPackage}|${fullPackageSize}|1234567890`);
  if (deltaPackage) {
    const deltaPackagePath = path.join(__dirname, '..', 'packages', deltaPackage);
    const deltaPackageSize = fs.statSync(deltaPackagePath).size;
    content.push(`${version}|${deltaPackage}|${deltaPackageSize}|1234567891`);
  }
  return content.join('\n');
}
