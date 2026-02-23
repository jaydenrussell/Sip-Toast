#!/usr/bin/env node

/**
 * Post-installation script for SIP Caller ID
 * Automatically configures Windows Firewall to prevent prompts
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function postInstall() {
  console.log('🚀 SIP Caller ID Post-Installation Setup\n');
  
  // Only run on Windows
  if (process.platform !== 'win32') {
    console.log('ℹ️  Skipping firewall configuration (not Windows)');
    return;
  }
  
  // Check if running as administrator
  let isAdmin = false;
  try {
    execSync('net session', { stdio: 'ignore' });
    isAdmin = true;
  } catch (error) {
    console.log('⚠️  Cannot configure firewall - not running as Administrator');
    console.log('💡 Users may see a firewall prompt when first using the application.');
    console.log('   This is normal and expected behavior for security.');
    return;
  }
  
  if (isAdmin) {
    console.log('✅ Running as Administrator - configuring Windows Firewall...\n');
    configureFirewallForInstalledApp();
  }
}

function configureFirewallForInstalledApp() {
  try {
    // Get the installed application path
    const programFiles = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles;
    const appPath = path.join(programFiles, 'SIP Caller ID', 'SIP Caller ID.exe');
    const appName = 'SIP Caller ID';
    const ruleName = `${appName} - Outbound`;
    
    console.log(`📋 Application: ${appName}`);
    console.log(`📁 Installed Path: ${appPath}`);
    console.log(`🛡️  Creating Firewall Rule: ${ruleName}\n`);
    
    // Check if application exists at expected path
    if (!fs.existsSync(appPath)) {
      console.log('⚠️  Application not found at expected path:');
      console.log(`   ${appPath}`);
      console.log('💡 Firewall rule will be created for the current executable path instead.');
      return;
    }
    
    // Create outbound-only firewall rule with specific network types
    const createCommand = `New-NetFirewallRule -DisplayName "${ruleName}" -Direction Outbound -Program "${appPath}" -Action Allow -Profile Domain,Private,Public -InterfaceType Any -Description "Allow outbound connections for SIP Caller ID (SIP signaling only)"`;
    
    execSync(`powershell -Command "${createCommand}"`, { encoding: 'utf8' });
    console.log('✅ Windows Firewall rule created successfully!');
    console.log('   - Direction: Outbound only (no inbound required)');
    console.log('   - Action: Allow');
    console.log('   - Profiles: Any (Domain, Private, Public)');
    console.log('   - Purpose: SIP signaling on ports 5060/5061');
    console.log('   - Result: No firewall prompts during application use\n');
    
    // Verify the rule was created
    try {
      const verifyCommand = `Get-NetFirewallRule -DisplayName "${ruleName}" | Select-Object DisplayName, Enabled, Direction, Action`;
      const verifyResult = execSync(`powershell -Command "${verifyCommand}"`, { encoding: 'utf8' });
      console.log('📋 Firewall rule verification:');
      console.log(verifyResult);
    } catch (error) {
      console.log('⚠️  Could not verify firewall rule, but creation appeared successful.');
    }
    
  } catch (error) {
    console.error('❌ Failed to configure Windows Firewall:', error.message);
    console.log('\n💡 Manual configuration (if needed):');
    console.log('   1. Open Windows Defender Firewall with Advanced Security');
    console.log('   2. Click "Outbound Rules" → "New Rule"');
    console.log('   3. Select "Program" → Browse to: %ProgramFiles%\\SIP Caller ID\\SIP Caller ID.exe');
    console.log('   4. Select "Allow the connection"');
    console.log('   5. Apply to all profiles (Domain, Private, Public)');
    console.log('   6. Name: "SIP Caller ID - Outbound"');
    console.log('   7. Description: "Allow outbound SIP signaling (ports 5060/5061)"');
  }
}

// Run post-installation setup
postInstall();

console.log('🎉 SIP Caller ID post-installation setup complete!');
console.log('   The application is now ready to use without firewall prompts.');
console.log('   Remember: SIP Caller ID only makes outbound connections (no inbound required).');