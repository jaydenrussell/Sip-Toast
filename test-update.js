#!/usr/bin/env node

/**
 * Test script to verify update mechanism
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

// Test the update service
async function testUpdateService() {
  console.log('🧪 Testing Update Service...\n');
  
  try {
    // Import the update service
    const UpdateService = require('./src/main/services/updateService');
    const updateService = new UpdateService();
    
    console.log('✅ Update service created successfully');
    
    // Test status
    const status = updateService.getStatus();
    console.log('📊 Initial status:', JSON.stringify(status, null, 2));
    
    // Test if we're in packaged mode
    if (!require('electron').app.isPackaged) {
      console.log('⚠️  Running in development mode - skipping update check');
      return;
    }
    
    console.log('🔄 Checking for updates...');
    
    // Listen for status updates
    updateService.on('update-status', (status) => {
      console.log('📈 Update status:', {
        checking: status.checking,
        downloading: status.downloading,
        available: status.updateAvailable,
        downloaded: status.updateDownloaded,
        progress: status.downloadProgress,
        current: status.currentVersion,
        availableVersion: status.availableVersion
      });
    });
    
    // Check for updates
    const result = await updateService.checkForUpdates();
    console.log('📋 Update check result:', result);
    
    if (result.updateAvailable) {
      console.log('✅ Update available!');
      if (result.updateDownloaded) {
        console.log('✅ Update downloaded and ready!');
      } else {
        console.log('⏳ Update downloading...');
      }
    } else {
      console.log('ℹ️  No updates available or already up to date');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Test Squirrel.Windows files
function testSquirrelFiles() {
  console.log('\n📁 Testing Squirrel.Windows files...\n');
  
  const distDir = path.join(__dirname, 'dist', 'squirrel-windows');
  
  if (!fs.existsSync(distDir)) {
    console.log('❌ dist/squirrel-windows directory not found');
    return;
  }
  
  const files = fs.readdirSync(distDir);
  const nupkgFiles = files.filter(f => f.endsWith('.nupkg'));
  const setupFiles = files.filter(f => f.endsWith('.exe'));
  const releasesFile = files.find(f => f === 'RELEASES');
  
  console.log(`📦 Found ${nupkgFiles.length} .nupkg files:`);
  nupkgFiles.forEach(file => console.log(`  - ${file}`));
  
  console.log(`\n🚀 Found ${setupFiles.length} setup files:`);
  setupFiles.forEach(file => console.log(`  - ${file}`));
  
  if (releasesFile) {
    console.log(`\n📋 RELEASES file found: ${releasesFile}`);
    const releasesPath = path.join(distDir, releasesFile);
    const releasesContent = fs.readFileSync(releasesPath, 'utf8');
    console.log('📄 RELEASES content preview:');
    console.log(releasesContent.substring(0, 500) + '...');
  } else {
    console.log('❌ RELEASES file not found');
  }
}

// Test Update.exe
function testUpdateExe() {
  console.log('\n🔧 Testing Update.exe...\n');
  
  // Look for Update.exe in common locations
  const possiblePaths = [
    path.join(__dirname, 'dist', 'win-unpacked', 'Update.exe'),
    path.join(__dirname, 'Update.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'SquirrelTemp', 'Update.exe')
  ];
  
  for (const updateExePath of possiblePaths) {
    if (fs.existsSync(updateExePath)) {
      console.log(`✅ Found Update.exe at: ${updateExePath}`);
      console.log(`📏 Size: ${fs.statSync(updateExePath).size} bytes`);
      return updateExePath;
    }
  }
  
  console.log('❌ Update.exe not found in expected locations');
  return null;
}

// Test package.json version
function testVersion() {
  console.log('\n📋 Testing version information...\n');
  
  const packageJsonPath = path.join(__dirname, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.log('❌ package.json not found');
    return;
  }
  
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  console.log(`📦 Package version: ${packageJson.version}`);
  console.log(`🎯 App ID: ${packageJson.build?.appId}`);
  console.log(`🏷️  Product name: ${packageJson.build?.productName}`);
}

// Run all tests
async function runTests() {
  console.log('🚀 Starting Update Mechanism Tests\n');
  console.log('='.repeat(50));
  
  testVersion();
  testSquirrelFiles();
  testUpdateExe();
  await testUpdateService();
  
  console.log('\n' + '='.repeat(50));
  console.log('🏁 Tests completed!');
}

// Run if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testUpdateService, testSquirrelFiles, testUpdateExe, testVersion };