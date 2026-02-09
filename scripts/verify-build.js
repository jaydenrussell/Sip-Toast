// Script to verify build files were created
const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '..', 'dist');
const packageJsonPath = path.join(__dirname, '..', 'package.json');

console.log('🔍 Verifying build...\n');

// Read package.json to get expected version
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const expectedVersion = packageJson.version;
console.log(`Expected version: ${expectedVersion}\n`);

// Check for build files
const msiFiles = [];
const appxFiles = [];

if (fs.existsSync(distPath)) {
  const files = fs.readdirSync(distPath);
  
  files.forEach(file => {
    if (file.endsWith('.msi')) {
      const filePath = path.join(distPath, file);
      const stats = fs.statSync(filePath);
      msiFiles.push({
        name: file,
        size: stats.size,
        modified: stats.mtime
      });
    } else if (file.endsWith('.appx')) {
      const filePath = path.join(distPath, file);
      const stats = fs.statSync(filePath);
      appxFiles.push({
        name: file,
        size: stats.size,
        modified: stats.mtime
      });
    }
  });
}

// Sort by modification time (newest first)
msiFiles.sort((a, b) => b.modified - a.modified);
appxFiles.sort((a, b) => b.modified - a.modified);

console.log('📦 MSI Files:');
if (msiFiles.length > 0) {
  msiFiles.forEach(file => {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const isExpected = file.name.includes(expectedVersion);
    const status = isExpected ? '✅' : '⚠️';
    console.log(`  ${status} ${file.name}`);
    console.log(`     Size: ${sizeMB} MB`);
    console.log(`     Modified: ${file.modified.toISOString()}`);
  });
} else {
  console.log('  ❌ No MSI files found');
}

console.log('\n📦 APPX Files:');
if (appxFiles.length > 0) {
  appxFiles.forEach(file => {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
    const isExpected = file.name.includes(expectedVersion);
    const status = isExpected ? '✅' : '⚠️';
    console.log(`  ${status} ${file.name}`);
    console.log(`     Size: ${sizeMB} MB`);
    console.log(`     Modified: ${file.modified.toISOString()}`);
  });
} else {
  console.log('  ❌ No APPX files found');
}

// Check for expected version files
const hasExpectedMsi = msiFiles.some(f => f.name.includes(expectedVersion));
const hasExpectedAppx = appxFiles.some(f => f.name.includes(expectedVersion));

console.log('\n📊 Summary:');
console.log(`  Expected version: ${expectedVersion}`);
console.log(`  MSI with expected version: ${hasExpectedMsi ? '✅ Yes' : '❌ No'}`);
console.log(`  APPX with expected version: ${hasExpectedAppx ? '✅ Yes' : '❌ No'}`);

if (hasExpectedMsi && hasExpectedAppx) {
  console.log('\n✅ Build verification: SUCCESS');
  process.exit(0);
} else {
  console.log('\n⚠️ Build verification: INCOMPLETE - Expected version files not found');
  process.exit(1);
}
