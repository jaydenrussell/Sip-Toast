// Wrapper script to ensure version increment and build
const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting build process...\n');

// Step 1: Increment version
console.log('📦 Step 1: Incrementing version...');
const incrementScript = spawn('node', [path.join(__dirname, 'increment-version.js')], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  shell: true
});

incrementScript.on('close', (code) => {
  if (code !== 0) {
    console.error(`❌ Version increment failed with code ${code}`);
    process.exit(code);
    return;
  }
  
  console.log('✅ Version incremented successfully\n');
  
  // Step 2: Run electron-builder
  console.log('🔨 Step 2: Building with electron-builder...');
  const buildProcess = spawn('npx', ['electron-builder', '--win'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true
  });
  
  buildProcess.on('close', (code) => {
    if (code !== 0) {
      console.error(`❌ Build failed with code ${code}`);
      process.exit(code);
      return;
    }
    
    console.log('\n✅ Build completed successfully!');
    process.exit(0);
  });
  
  buildProcess.on('error', (error) => {
    console.error(`❌ Failed to start build process: ${error.message}`);
    process.exit(1);
  });
});

incrementScript.on('error', (error) => {
  console.error(`❌ Failed to start version increment: ${error.message}`);
  process.exit(1);
});
