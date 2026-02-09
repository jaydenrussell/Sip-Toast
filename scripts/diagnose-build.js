// Diagnostic script to check build setup
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const results = {
  timestamp: new Date().toISOString(),
  checks: []
};

function logCheck(name, status, message) {
  results.checks.push({ name, status, message, time: new Date().toISOString() });
  const icon = status === 'pass' ? '✅' : status === 'fail' ? '❌' : '⚠️';
  console.log(`${icon} ${name}: ${message}`);
}

// Check 1: package.json exists
const packageJsonPath = path.join(__dirname, '..', 'package.json');
if (fs.existsSync(packageJsonPath)) {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  logCheck('package.json', 'pass', `Found, version: ${pkg.version}`);
  
  // Check prepackage script
  if (pkg.scripts && pkg.scripts.prepackage) {
    logCheck('prepackage script', 'pass', `Configured: ${pkg.scripts.prepackage}`);
  } else {
    logCheck('prepackage script', 'fail', 'Not configured');
  }
  
  // Check package script
  if (pkg.scripts && pkg.scripts.package) {
    logCheck('package script', 'pass', `Configured: ${pkg.scripts.package}`);
  } else {
    logCheck('package script', 'fail', 'Not configured');
  }
} else {
  logCheck('package.json', 'fail', 'Not found');
}

// Check 2: increment-version.js exists
const incrementScript = path.join(__dirname, 'increment-version.js');
if (fs.existsSync(incrementScript)) {
  logCheck('increment-version.js', 'pass', 'Found');
} else {
  logCheck('increment-version.js', 'fail', 'Not found');
}

// Check 3: dist folder
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  const files = fs.readdirSync(distPath);
  const msiFiles = files.filter(f => f.endsWith('.msi'));
  const appxFiles = files.filter(f => f.endsWith('.appx'));
  logCheck('dist folder', 'pass', `Found, ${msiFiles.length} MSI, ${appxFiles.length} APPX files`);
  
  if (msiFiles.length > 0) {
    msiFiles.sort().reverse();
    const latest = msiFiles[0];
    logCheck('Latest MSI', 'info', latest);
  }
  if (appxFiles.length > 0) {
    appxFiles.sort().reverse();
    const latest = appxFiles[0];
    logCheck('Latest APPX', 'info', latest);
  }
} else {
  logCheck('dist folder', 'warn', 'Not found (will be created on first build)');
}

// Check 4: node_modules/electron-builder
const electronBuilderPath = path.join(__dirname, '..', 'node_modules', 'electron-builder');
if (fs.existsSync(electronBuilderPath)) {
  logCheck('electron-builder', 'pass', 'Installed');
} else {
  logCheck('electron-builder', 'fail', 'Not installed - run: npm install');
}

// Check 5: Test increment script
console.log('\n🧪 Testing increment script...');
try {
  const testResult = spawn('node', [incrementScript], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe'
  });
  
  let output = '';
  testResult.stdout.on('data', (data) => {
    output += data.toString();
  });
  
  testResult.stderr.on('data', (data) => {
    output += data.toString();
  });
  
  testResult.on('close', (code) => {
    if (code === 0) {
      logCheck('increment script test', 'pass', 'Executed successfully');
      if (output) {
        console.log('Output:', output.trim());
      }
    } else {
      logCheck('increment script test', 'fail', `Exit code: ${code}`);
      if (output) {
        console.log('Error:', output.trim());
      }
    }
    
    // Write results to file
    const resultsPath = path.join(__dirname, '..', 'diagnostic-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`\n📄 Results saved to: ${resultsPath}`);
    
    // Summary
    const passed = results.checks.filter(c => c.status === 'pass').length;
    const failed = results.checks.filter(c => c.status === 'fail').length;
    console.log(`\n📊 Summary: ${passed} passed, ${failed} failed`);
  });
} catch (error) {
  logCheck('increment script test', 'fail', error.message);
}
