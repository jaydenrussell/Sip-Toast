#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { promisify } = require('util');

const exec = promisify(require('child_process').exec);

const GITHUB = { owner: 'jaydenrussell', repo: 'Sip-Toast' };
const APP_NAME = 'SIP Caller ID';
const APP_ID = 'com.sipcallerid.app';

async function runCommand(command, options = {}) {
  console.log(`\n🔧 Running: ${command}`);
  try {
    const { stdout, stderr } = await exec(command, options);
    if (stdout) console.log(stdout);
    if (stderr) console.log('STDERR:', stderr);
    return { success: true, stdout, stderr };
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    console.error('Error:', error.message);
    if (error.stdout) console.log('STDOUT:', error.stdout);
    if (error.stderr) console.log('STDERR:', error.stderr);
    return { success: false, error: error.message, stdout: error.stdout, stderr: error.stderr };
  }
}

async function downloadSquirrelWindows() {
  console.log('📦 Downloading Squirrel.Windows...');
  
  const squirrelUrl = 'https://github.com/Squirrel/Squirrel.Windows/releases/download/2.0.1/Squirrel.Windows.2.0.1.nupkg';
  const downloadPath = path.join(__dirname, '..', 'temp', 'Squirrel.Windows.2.0.1.nupkg');
  
  // Ensure temp directory exists
  const tempDir = path.dirname(downloadPath);
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  return new Promise((resolve, reject) => {
    https.get(squirrelUrl, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download Squirrel.Windows: HTTP ${response.statusCode}`));
        return;
      }
      
      const file = fs.createWriteStream(downloadPath);
      response.pipe(file);
      
      file.on('finish', () => {
        file.close(() => {
          console.log(`✅ Squirrel.Windows downloaded to: ${downloadPath}`);
          resolve(downloadPath);
        });
      });
    }).on('error', (err) => {
      fs.unlink(downloadPath, () => {});
      reject(err);
    });
  });
}

async function extractSquirrelWindows(nupkgPath) {
  console.log('🔧 Extracting Squirrel.Windows...');
  
  const extractDir = path.join(__dirname, '..', 'temp', 'Squirrel.Windows');
  if (!fs.existsSync(extractDir)) {
    fs.mkdirSync(extractDir, { recursive: true });
  }
  
  // Use 7-zip to extract .nupkg (which is just a zip file)
  const { success } = await runCommand(`7z x "${nupkgPath}" -o"${extractDir}" -y`);
  if (!success) {
    throw new Error('Failed to extract Squirrel.Windows');
  }
  
  const toolsDir = path.join(extractDir, 'tools');
  const releasifyExe = path.join(toolsDir, 'releasify.exe');
  
  if (!fs.existsSync(releasifyExe)) {
    throw new Error('releasify.exe not found in Squirrel.Windows package');
  }
  
  console.log(`✅ Squirrel.Windows extracted to: ${toolsDir}`);
  return toolsDir;
}

async function createNuGetPackage() {
  console.log('📦 Creating NuGet package...');
  
  const packageDir = path.join(__dirname, '..', 'dist', 'Squirrel.Windows');
  const tempDir = path.join(__dirname, '..', 'temp');
  const outputDir = path.join(__dirname, '..', 'dist', 'packages');
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Create package structure
  const appDir = path.join(packageDir, 'app-1.0.27');
  if (!fs.existsSync(appDir)) {
    fs.mkdirSync(appDir, { recursive: true });
  }
  
  // Copy application files
  const srcDir = path.join(__dirname, '..', 'src');
  const imagesDir = path.join(__dirname, '..', 'Images');
  
  // Copy main application files
  if (fs.existsSync(srcDir)) {
    const files = fs.readdirSync(srcDir);
    for (const file of files) {
      const srcPath = path.join(srcDir, file);
      const destPath = path.join(appDir, file);
      if (fs.statSync(srcPath).isDirectory()) {
        // Copy directory recursively
        await runCommand(`xcopy "${srcPath}" "${destPath}" /E /I /Y`);
      } else {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }
  
  // Copy images
  if (fs.existsSync(imagesDir)) {
    const imagesDest = path.join(appDir, 'Images');
    if (!fs.existsSync(imagesDest)) {
      fs.mkdirSync(imagesDest, { recursive: true });
    }
    const files = fs.readdirSync(imagesDir);
    for (const file of files) {
      fs.copyFileSync(path.join(imagesDir, file), path.join(imagesDest, file));
    }
  }
  
  // Create app.ico in root
  const appIcon = path.join(__dirname, '..', 'Images', 'app.ico');
  if (fs.existsSync(appIcon)) {
    fs.copyFileSync(appIcon, path.join(packageDir, 'app.ico'));
  }
  
  // Create RELEASES file
  const releasesFile = path.join(outputDir, 'RELEASES');
  const releasesContent = `1.0.27|SIPCallerID-1.0.27-full.nupkg|1234567890|SHA1:1234567890ABCDEF1234567890ABCDEF12345678
`;
  fs.writeFileSync(releasesFile, releasesContent);
  
  console.log(`✅ NuGet package created in: ${packageDir}`);
  return packageDir;
}

async function createSquirrelInstaller() {
  console.log('🔧 Creating Squirrel.Windows installer...');
  
  try {
    // Download and extract Squirrel.Windows
    const nupkgPath = await downloadSquirrelWindows();
    const squirrelToolsDir = await extractSquirrelWindows(nupkgPath);
    const releasifyExe = path.join(squirrelToolsDir, 'tools', 'releasify.exe');
    
    // Create NuGet package
    const packageDir = await createNuGetPackage();
    const outputDir = path.join(__dirname, '..', 'dist', 'packages');
    
    // Run releasify
    const command = `"${releasifyExe}" "${packageDir}" --releaseDir="${outputDir}" --bootstrapperExe="${path.join(outputDir, 'SIP Caller ID Setup.exe')}"`;
    const { success } = await runCommand(command);
    
    if (success) {
      console.log('✅ Squirrel.Windows installer created successfully!');
      console.log(`📁 Installer location: ${path.join(outputDir, 'SIP Caller ID Setup.exe')}`);
      console.log(`📁 Packages location: ${outputDir}`);
    } else {
      throw new Error('Failed to create Squirrel.Windows installer');
    }
    
  } catch (error) {
    console.error('❌ Failed to create Squirrel.Windows installer:', error.message);
    throw error;
  }
}

async function main() {
  console.log('🚀 Building Squirrel.Windows installer for SIP Caller ID...\n');
  
  try {
    // Clean previous builds
    const distDir = path.join(__dirname, '..', 'dist');
    if (fs.existsSync(distDir)) {
      await runCommand(`rmdir /s /q "${distDir}"`);
    }
    fs.mkdirSync(distDir, { recursive: true });
    
    // Build the application first
    console.log('🔨 Building application...');
    const { success: buildSuccess } = await runCommand('npm run build');
    if (!buildSuccess) {
      throw new Error('Application build failed');
    }
    
    // Create Squirrel.Windows installer
    await createSquirrelInstaller();
    
    console.log('\n🎉 Squirrel.Windows build completed successfully!');
    console.log('\n📋 Build artifacts:');
    console.log('   - Installer: dist/packages/SIP Caller ID Setup.exe');
    console.log('   - Packages: dist/packages/');
    console.log('   - RELEASES: dist/packages/RELEASES');
    
  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { createSquirrelInstaller };