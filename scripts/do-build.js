// Complete build script that writes all output to a log file
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const logFile = path.join(__dirname, '..', 'build-complete.log');
const distPath = path.join(__dirname, '..', 'dist');

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(logFile, logMessage, 'utf8');
  console.log(message);
}

try {
  log('🚀 Starting complete build process...');
  
  // Step 1: Increment version
  log('📦 Step 1: Incrementing version...');
  try {
    const incrementOutput = execSync('node scripts/increment-version.js', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      stdio: 'pipe'
    });
    log('Increment output: ' + incrementOutput);
    
    // Verify version was updated
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    log(`✅ Version is now: ${packageJson.version}`);
  } catch (error) {
    log(`❌ Version increment failed: ${error.message}`);
    throw error;
  }
  
  // Step 2: Run electron-builder
  log('\n🔨 Step 2: Building with electron-builder...');
  try {
    execSync('npx electron-builder --win', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      stdio: 'inherit'
    });
    log('✅ electron-builder completed');
  } catch (error) {
    log(`❌ Build failed: ${error.message}`);
    throw error;
  }
  
  // Step 3: Verify build files
  log('\n📋 Step 3: Verifying build files...');
  if (fs.existsSync(distPath)) {
    const files = fs.readdirSync(distPath);
    const msiFiles = files.filter(f => f.endsWith('.msi'));
    const appxFiles = files.filter(f => f.endsWith('.appx'));
    
    log(`Found ${msiFiles.length} MSI files and ${appxFiles.length} APPX files`);
    
    if (msiFiles.length > 0) {
      msiFiles.sort().reverse();
      const latestMsi = msiFiles[0];
      const msiPath = path.join(distPath, latestMsi);
      const msiStats = fs.statSync(msiPath);
      log(`Latest MSI: ${latestMsi} (${(msiStats.size / 1024 / 1024).toFixed(2)} MB)`);
    }
    
    if (appxFiles.length > 0) {
      appxFiles.sort().reverse();
      const latestAppx = appxFiles[0];
      const appxPath = path.join(distPath, latestAppx);
      const appxStats = fs.statSync(appxPath);
      log(`Latest APPX: ${latestAppx} (${(appxStats.size / 1024 / 1024).toFixed(2)} MB)`);
    }
  }
  
  log('\n✅ Build process completed successfully!');
  log(`📄 Full log saved to: ${logFile}`);
  
} catch (error) {
  log(`\n❌ Build process failed: ${error.message}`);
  log(`Stack: ${error.stack}`);
  process.exit(1);
}
