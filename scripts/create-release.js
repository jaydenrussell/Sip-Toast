const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Script to create a GitHub release with the current version and upload MSI installer
 * 
 * Usage:
 *   node scripts/create-release.js [version]
 * 
 * If version is not provided, uses version from package.json
 * 
 * Requirements:
 *   - GitHub CLI (gh) must be installed and authenticated
 *   - MSI installer must exist in dist/ directory
 *   - Must be run from repository root
 */

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const distPath = path.join(__dirname, '..', 'dist');

// Get version from command line or package.json
const args = process.argv.slice(2);
let version = args[0];

if (!version) {
  // Read version from package.json
  if (!fs.existsSync(packageJsonPath)) {
    console.error('❌ Error: package.json not found');
    process.exit(1);
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  version = packageJson.version;
  
  if (!version) {
    console.error('❌ Error: version not found in package.json');
    process.exit(1);
  }
}

// Validate version format
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`❌ Error: Invalid version format: ${version}. Expected format: x.y.z`);
  process.exit(1);
}

const tagName = `v${version}`;

console.log(`📦 Creating release for version ${version} (tag: ${tagName})`);

// Check if GitHub CLI is installed
try {
  execSync('gh --version', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ Error: GitHub CLI (gh) is not installed or not in PATH');
  console.error('   Install from: https://cli.github.com/');
  console.error('   Then authenticate with: gh auth login');
  process.exit(1);
}

// Check if already authenticated
try {
  execSync('gh auth status', { stdio: 'ignore' });
} catch (error) {
  console.error('❌ Error: Not authenticated with GitHub CLI');
  console.error('   Run: gh auth login');
  process.exit(1);
}

// Find MSI installer matching the version
const allMsiFiles = fs.readdirSync(distPath).filter(file => file.endsWith('.msi'));

// Filter to find MSI files that match the version we're releasing
// Match patterns like: "SIP Toast 0.68.4.msi", "Sip-Toast-0.68.4.msi", "sip-toast-0.68.4.msi"
const versionEscaped = version.replace(/\./g, '\\.');
const versionPattern = new RegExp(`(^|[\\s_-])v?${versionEscaped}(\\.msi|$)`, 'i');
const matchingMsiFiles = allMsiFiles.filter(file => versionPattern.test(file));

let msiFile;
let msiPath;

if (matchingMsiFiles.length > 0) {
  // Use the matching version MSI
  msiFile = matchingMsiFiles[0];
  msiPath = path.join(distPath, msiFile);
  console.log(`📁 Found matching MSI installer for v${version}: ${msiFile}`);
} else {
  // Fallback: try to find any MSI (for backwards compatibility or manual builds)
  if (allMsiFiles.length === 0) {
    console.error('❌ Error: No MSI installer found in dist/ directory');
    console.error('   Build the application first with: npm run package');
    process.exit(1);
  }
  
  // Log warning about version mismatch
  console.warn(`⚠️  Warning: No MSI file matching version ${version} found`);
  console.warn(`   Available MSI files: ${allMsiFiles.join(', ')}`);
  
  // Use the most recent MSI file (by modification time)
  const msiStats = allMsiFiles.map(file => ({
    name: file,
    path: path.join(distPath, file),
    mtime: fs.statSync(path.join(distPath, file)).mtime
  }));
  msiStats.sort((a, b) => b.mtime - a.mtime);
  
  msiFile = msiStats[0].name;
  msiPath = msiStats[0].path;
  console.warn(`   Using most recent MSI: ${msiFile} (may not match version)`);
}

// Check if tag already exists
(async () => {
  try {
    execSync(`git rev-parse ${tagName}`, { stdio: 'ignore' });
    console.log(`⚠️  Warning: Tag ${tagName} already exists`);
    
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise((resolve) => {
      readline.question('Do you want to delete and recreate it? (y/N): ', resolve);
    });
    
    readline.close();
    
    if (answer.toLowerCase() === 'y') {
      console.log(`🗑️  Deleting existing tag ${tagName}...`);
      try {
        execSync(`git tag -d ${tagName}`, { stdio: 'inherit' });
        execSync(`git push origin :refs/tags/${tagName}`, { stdio: 'inherit' });
      } catch (error) {
        console.error(`⚠️  Could not delete remote tag (may not exist): ${error.message}`);
      }
    } else {
      console.log('❌ Aborted');
      process.exit(1);
    }
  } catch (error) {
    // Tag doesn't exist, which is fine - continue
  }
  
  // Create tag
  console.log(`🏷️  Creating tag ${tagName}...`);
  try {
    execSync(`git tag -a ${tagName} -m "Release ${version}"`, { stdio: 'inherit' });
    execSync(`git push origin ${tagName}`, { stdio: 'inherit' });
  } catch (error) {
    console.error(`❌ Error creating tag: ${error.message}`);
    process.exit(1);
  }
  
  // Create release
  console.log(`🚀 Creating GitHub release...`);
  const releaseNotes = `## SIP Toast v${version}
  
  ### Installation
  Download the MSI installer below and run it to install or update SIP Toast.
  
  ### Auto-Update
  If you have SIP Toast installed, it will automatically check for this update based on your update settings.
  
  ### Changes
  See commit history for details.`;
  
  try {
    // Create release using GitHub CLI
    execSync(
      `gh release create ${tagName} "${msiPath}" --title "Release v${version}" --notes "${releaseNotes}"`,
      { stdio: 'inherit' }
    );
    
    // Get repository info from package.json
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const repoUrl = packageJson.repository?.url || '';
    const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)\.git/);
    
    if (repoMatch) {
      const [, owner, repo] = repoMatch;
      console.log(`✅ Successfully created release ${tagName}`);
      console.log(`   Release URL: https://github.com/${owner}/${repo}/releases/tag/${tagName}`);
    } else {
      console.log(`✅ Successfully created release ${tagName}`);
    }
  } catch (error) {
    console.error(`❌ Error creating release: ${error.message}`);
    process.exit(1);
  }
})();

