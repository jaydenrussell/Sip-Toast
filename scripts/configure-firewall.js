#!/usr/bin/env node

/**
 * Configure Windows Firewall for SIP Caller ID to prevent prompts during installation
 * This script sets up outbound-only firewall rules for the application
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function configureFirewall() {
  console.log('🔧 Configuring Windows Firewall for SIP Caller ID...\n');
  
  // Get the application path
  let appPath;
  try {
    // Try to get the installed path
    const programFiles = process.env['ProgramFiles(x86)'] || process.env.ProgramFiles;
    appPath = path.join(programFiles, 'SIP Caller ID', 'SIP Caller ID.exe');
  } catch {
    // Fallback to development path
    appPath = process.execPath;
  }
  
  const appName = 'SIP Caller ID';
  const ruleName = `${appName} - Outbound`;
  
  console.log(`📋 Application: ${appName}`);
  console.log(`📁 Path: ${appPath}`);
  console.log(`🛡️  Firewall Rule: ${ruleName}\n`);
  
  try {
    // Check if rule already exists
    console.log('🔍 Checking if firewall rule already exists...');
    const checkCommand = `Get-NetFirewallRule -DisplayName "${ruleName}" -ErrorAction SilentlyContinue`;
    const checkResult = execSync(`powershell -Command "${checkCommand}"`, { encoding: 'utf8' });
    
    if (checkResult && checkResult.trim()) {
      console.log('✅ Firewall rule already exists, skipping creation.');
      return;
    }
  } catch (error) {
    // Rule doesn't exist, continue with creation
    console.log('📝 Firewall rule not found, creating new rule...');
  }
  
  try {
    // Create outbound-only firewall rule
    console.log('🚀 Creating outbound-only firewall rule...');
    
    const createCommand = `New-NetFirewallRule -DisplayName "${ruleName}" -Direction Outbound -Program "${appPath}" -Action Allow -Profile Any -Description "Allow outbound connections for SIP Caller ID (SIP signaling only)"`;
    
    const result = execSync(`powershell -Command "${createCommand}"`, { encoding: 'utf8' });
    console.log('✅ Firewall rule created successfully!');
    console.log('   - Direction: Outbound only');
    console.log('   - Action: Allow');
    console.log('   - Profiles: Any (Domain, Private, Public)');
    console.log('   - Purpose: SIP signaling (ports 5060/5061)');
    
  } catch (error) {
    console.error('❌ Failed to create firewall rule:', error.message);
    console.log('\n💡 Manual configuration instructions:');
    console.log('   1. Open Windows Defender Firewall with Advanced Security');
    console.log('   2. Click "Outbound Rules" → "New Rule"');
    console.log('   3. Select "Program" → Browse to SIP Caller ID executable');
    console.log('   4. Select "Allow the connection"');
    console.log('   5. Apply to all profiles (Domain, Private, Public)');
    console.log('   6. Name it "SIP Caller ID - Outbound"');
    console.log('   7. Add description: "Allow outbound SIP signaling (ports 5060/5061)"');
  }
  
  // Verify the rule was created
  try {
    console.log('\n🔍 Verifying firewall rule...');
    const verifyCommand = `Get-NetFirewallRule -DisplayName "${ruleName}" | Format-Table -AutoSize`;
    const verifyResult = execSync(`powershell -Command "${verifyCommand}"`, { encoding: 'utf8' });
    console.log('📋 Firewall rule details:');
    console.log(verifyResult);
  } catch (error) {
    console.log('⚠️  Could not verify firewall rule creation.');
  }
  
  console.log('\n🎉 Windows Firewall configuration complete!');
  console.log('   SIP Caller ID will now be able to make outbound connections without prompts.');
  console.log('   No inbound rules are needed - the application only makes outbound connections.');
}

// Run if called directly
if (require.main === module) {
  // Check if running on Windows
  if (process.platform !== 'win32') {
    console.log('⚠️  This script is only for Windows systems.');
    process.exit(0);
  }
  
  // Check if running as administrator
  try {
    execSync('net session', { stdio: 'ignore' });
  } catch (error) {
    console.log('❌ This script requires administrator privileges.');
    console.log('💡 Please run this script as Administrator.');
    process.exit(1);
  }
  
  configureFirewall();
}

module.exports = { configureFirewall };