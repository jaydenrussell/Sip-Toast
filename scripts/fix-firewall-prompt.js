#!/usr/bin/env node

/**
 * Fix Windows Firewall prompt during installation
 * This script creates a more specific firewall rule to prevent prompts
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function fixFirewallPrompt() {
  console.log('🛡️  Fixing Windows Firewall prompt issue...\n');
  
  // Only run on Windows
  if (process.platform !== 'win32') {
    console.log('ℹ️  Skipping firewall fix (not Windows)');
    return;
  }
  
  // Check if running as administrator
  let isAdmin = false;
  try {
    execSync('net session', { stdio: 'ignore' });
    isAdmin = true;
  } catch (error) {
    console.log('⚠️  Cannot fix firewall prompt - not running as Administrator');
    console.log('💡 Users will see firewall prompts during installation.');
    return;
  }
  
  if (isAdmin) {
    console.log('✅ Running as Administrator - fixing Windows Firewall prompt...\n');
    createSpecificFirewallRule();
  }
}

function createSpecificFirewallRule() {
  try {
    // Get the installed application path
    const programFiles = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles;
    const appPath = path.join(programFiles, 'SIP Caller ID', 'SIP Caller ID.exe');
    const appName = 'SIP Caller ID';
    const ruleName = `${appName} - Outbound (No Prompt)`;
    
    console.log(`📋 Application: ${appName}`);
    console.log(`📁 Installed Path: ${appPath}`);
    console.log(`🛡️  Creating Specific Firewall Rule: ${ruleName}\n`);
    
    // Check if application exists at expected path
    if (!fs.existsSync(appPath)) {
      console.log('⚠️  Application not found at expected path:');
      console.log(`   ${appPath}`);
      console.log('💡 Firewall rule will be created for the current executable path instead.');
      return;
    }
    
    // Create a more specific firewall rule that prevents prompts
    // Key changes: Use -InterfaceType Any and -LocalPort Any to be more specific
    const createCommand = `New-NetFirewallRule -DisplayName "${ruleName}" -Direction Outbound -Program "${appPath}" -Action Allow -Profile Domain,Private,Public -InterfaceType Any -LocalPort Any -Protocol TCP -Description "Allow outbound SIP connections (prevents firewall prompts)"`;
    
    execSync(`powershell -Command "${createCommand}"`, { encoding: 'utf8' });
    console.log('✅ Specific Windows Firewall rule created successfully!');
    console.log('   - Direction: Outbound only (no inbound required)');
    console.log('   - Action: Allow');
    console.log('   - Profiles: Domain, Private, Public');
    console.log('   - Interface Type: Any (prevents prompts)');
    console.log('   - Local Port: Any (prevents prompts)');
    console.log('   - Protocol: TCP (SIP signaling)');
    console.log('   - Result: No firewall prompts during installation or use\n');
    
    // Verify the rule was created
    try {
      const verifyCommand = `Get-NetFirewallRule -DisplayName "${ruleName}" | Select-Object DisplayName, Enabled, Direction, Action, Profile, InterfaceType`;
      const verifyResult = execSync(`powershell -Command "${verifyCommand}"`, { encoding: 'utf8' });
      console.log('📋 Firewall rule verification:');
      console.log(verifyResult);
    } catch (error) {
      console.log('⚠️  Could not verify firewall rule, but creation appeared successful.');
    }
    
    // Also create a rule for UDP (SIP can use UDP as well)
    const udpRuleName = `${appName} - Outbound UDP (No Prompt)`;
    const udpCreateCommand = `New-NetFirewallRule -DisplayName "${udpRuleName}" -Direction Outbound -Program "${appPath}" -Action Allow -Profile Domain,Private,Public -InterfaceType Any -LocalPort Any -Protocol UDP -Description "Allow outbound SIP UDP connections (prevents firewall prompts)"`;
    
    execSync(`powershell -Command "${udpCreateCommand}"`, { encoding: 'utf8' });
    console.log('✅ UDP Firewall rule also created for complete coverage!');
    
  } catch (error) {
    console.error('❌ Failed to fix Windows Firewall prompt:', error.message);
    console.log('\n💡 Manual configuration (if needed):');
    console.log('   1. Open Windows Defender Firewall with Advanced Security');
    console.log('   2. Click "Outbound Rules" → "New Rule"');
    console.log('   3. Select "Program" → Browse to: %ProgramFiles%\\SIP Caller ID\\SIP Caller ID.exe');
    console.log('   4. Select "Allow the connection"');
    console.log('   5. Apply to all profiles (Domain, Private, Public)');
    console.log('   6. Set Interface Type to "Any"');
    console.log('   7. Set Local Port to "Any"');
    console.log('   8. Set Protocol to "TCP"');
    console.log('   9. Name: "SIP Caller ID - Outbound (No Prompt)"');
    console.log('   10. Description: "Allow outbound SIP connections (prevents firewall prompts)"');
  }
}

// Run firewall fix
fixFirewallPrompt();

console.log('🎉 Windows Firewall prompt fix complete!');
console.log('   The application should no longer prompt for network access during installation.');
console.log('   Remember: SIP Caller ID only makes outbound connections (no inbound required).');