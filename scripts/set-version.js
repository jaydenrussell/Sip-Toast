const fs = require('fs');
const path = require('path');

try {
  const packageJsonPath = path.join(__dirname, '..', 'package.json');
  
  // Verify file exists
  if (!fs.existsSync(packageJsonPath)) {
    console.error(`❌ Error: package.json not found at ${packageJsonPath}`);
    process.exit(1);
  }
  
  // Read and parse package.json
  const packageJsonContent = fs.readFileSync(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonContent);
  
  // Store old version for logging
  const oldVersion = packageJson.version;
  
  if (!oldVersion) {
    console.error('❌ Error: version field not found in package.json');
    process.exit(1);
  }
  
  // Set new version to 1.0.5
  const newVersion = '1.0.5';
  
  // Update version
  packageJson.version = newVersion;
  
  // Store build date in ISO format (will be formatted when displayed)
  packageJson.buildDate = new Date().toISOString();
  
  // Write back to package.json with proper formatting
  const updatedContent = JSON.stringify(packageJson, null, 2) + '\n';
  fs.writeFileSync(packageJsonPath, updatedContent, 'utf8');
  
  // Verify the write was successful
  const verifyContent = fs.readFileSync(packageJsonPath, 'utf8');
  const verifyJson = JSON.parse(verifyContent);
  
  if (verifyJson.version !== newVersion) {
    console.error(`❌ Error: Version verification failed. Expected ${newVersion}, got ${verifyJson.version}`);
    process.exit(1);
  }
  
  console.log(`✓ Version updated from ${oldVersion} to ${newVersion}`);
  console.log(`✓ Build date updated to: ${packageJson.buildDate}`);
  // Don't call process.exit(0) - let npm handle the exit
} catch (error) {
  console.error(`❌ Error in set-version.js: ${error.message}`);
  console.error(error.stack);
  process.exit(1); // Only exit with error code on failure
}