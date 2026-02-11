const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { app } = require('electron');
const { logger } = require('./logger');

const execAsync = promisify(exec);

/**
 * Check Windows Firewall configuration for SIP Toast
 * Returns firewall status and recommendations
 */
async function checkFirewallStatus() {
  const results = {
    firewallEnabled: false,
    outboundAllowed: true, // Default assumption
    inboundAllowed: false, // Not needed for this app
    appRules: [],
    portRules: [],
    recommendations: [],
    status: 'unknown',
    details: {}
  };

  try {
    // Check if Windows Firewall is enabled
    const firewallStatus = await checkFirewallEnabled();
    results.firewallEnabled = firewallStatus.enabled;
    results.details.firewallStatus = firewallStatus;

    if (!firewallStatus.enabled) {
      results.status = 'disabled';
      results.recommendations.push({
        type: 'info',
        message: 'Windows Firewall is disabled. This is generally safe if you have other firewall software.',
        action: null
      });
      return results;
    }

    // Check application-specific firewall rules
    const appRules = await checkApplicationRules();
    results.appRules = appRules;
    results.details.appRules = appRules;

    // Check if outbound connections are generally allowed
    const outboundStatus = await checkOutboundStatus();
    results.outboundAllowed = outboundStatus.allowed;
    results.details.outboundStatus = outboundStatus;

    // Check common SIP ports
    const portRules = await checkPortRules();
    results.portRules = portRules;
    results.details.portRules = portRules;

    // Determine overall status
    if (appRules.length > 0 && appRules.some(rule => rule.enabled && rule.direction === 'outbound')) {
      results.status = 'configured';
      results.recommendations.push({
        type: 'success',
        message: 'Firewall rules found for SIP Toast. Outbound connections should work.',
        action: null
      });
    } else if (outboundStatus.allowed) {
      results.status = 'permissive';
      results.recommendations.push({
        type: 'warning',
        message: 'No specific firewall rules found, but outbound connections appear to be allowed by default.',
        action: 'Consider adding explicit firewall rules for better security.'
      });
    } else {
      results.status = 'restrictive';
      results.recommendations.push({
        type: 'error',
        message: 'Outbound connections may be blocked. SIP Toast requires outbound connections to work.',
        action: 'Add firewall rules to allow SIP Toast outbound connections.'
      });
    }

    // Add specific recommendations based on findings
    if (appRules.length === 0) {
      results.recommendations.push({
        type: 'info',
        message: 'No specific firewall rules found for SIP Toast.',
        action: 'Windows Firewall will prompt you when the app first connects, or you can add rules manually.'
      });
    }

  } catch (error) {
    logger.error(`Firewall check error: ${error.message}`);
    results.status = 'error';
    results.details.error = error.message;
    results.recommendations.push({
      type: 'error',
      message: `Unable to check firewall status: ${error.message}`,
      action: 'Check Windows Firewall settings manually.'
    });
  }

  return results;
}

/**
 * Check if Windows Firewall is enabled
 */
async function checkFirewallEnabled() {
  try {
    const { stdout } = await execAsync('netsh advfirewall show allprofiles state');
    const enabled = stdout.includes('ON');
    
    return {
      enabled,
      details: stdout
    };
  } catch (error) {
    logger.warn(`Failed to check firewall status: ${error.message}`);
    return {
      enabled: null,
      error: error.message
    };
  }
}

/**
 * Check for application-specific firewall rules
 */
async function checkApplicationRules() {
  try {
    let appPath;
    try {
      appPath = app.getPath('exe');
    } catch {
      appPath = process.execPath;
    }
    const appName = path.basename(appPath, '.exe');
    
    // Check for rules matching the application
    const { stdout } = await execAsync(`netsh advfirewall firewall show rule name=all | findstr /i "${appName}"`);
    
    const rules = [];
    if (stdout && stdout.trim()) {
      // Parse rules (simplified - netsh output can be complex)
      const lines = stdout.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        if (line.includes('Rule Name:')) {
          const ruleName = line.split('Rule Name:')[1]?.trim();
          if (ruleName) {
            rules.push({
              name: ruleName,
              enabled: true, // Assume enabled if found
              direction: 'outbound', // Default
              action: 'allow'
            });
          }
        }
      }
    }

    // Also check using PowerShell for more detailed info
    try {
      // Escape the appName for PowerShell (handle quotes and special chars)
      const escapedAppName = appName.replace(/'/g, "''");
      const psCommand = `Get-NetFirewallRule | Where-Object { $_.DisplayName -like '*${escapedAppName}*' -or $_.Program -like '*${escapedAppName}*' } | Select-Object DisplayName, Enabled, Direction, Action | ConvertTo-Json -Compress`;
      const { stdout: psOutput } = await execAsync(`powershell -ExecutionPolicy Bypass -Command "${psCommand}"`, { timeout: 10000 });
      
      if (psOutput && psOutput.trim()) {
        try {
          const psRules = JSON.parse(psOutput);
          // Handle both single object and array results
          const ruleArray = Array.isArray(psRules) ? psRules : (psRules ? [psRules] : []);
          
          if (ruleArray.length > 0 && ruleArray[0].DisplayName) {
            return ruleArray.map(rule => ({
              name: rule.DisplayName || 'Unknown',
              enabled: rule.Enabled === true || rule.Enabled === 'True',
              direction: (rule.Direction || 'Outbound').toLowerCase(),
              action: (rule.Action || 'Allow').toLowerCase()
            }));
          }
        } catch (parseError) {
          logger.debug(`Failed to parse PowerShell output: ${parseError.message}`);
        }
      }
    } catch (psError) {
      // PowerShell check failed, use netsh results
      logger.debug(`PowerShell firewall check failed: ${psError.message}`);
    }

    return rules;
  } catch (error) {
    // No rules found or error
    if (error.code === 1) {
      // findstr returns code 1 when no matches found
      return [];
    }
    logger.warn(`Failed to check application firewall rules: ${error.message}`);
    return [];
  }
}

/**
 * Check outbound firewall status
 */
async function checkOutboundStatus() {
  try {
    // Check default outbound action
    const { stdout } = await execAsync('netsh advfirewall show allprofiles firewallpolicy');
    
    // Parse output to find outbound action
    const outboundMatch = stdout.match(/Outbound.*?Action:\s*(\w+)/i);
    const outboundAction = outboundMatch ? outboundMatch[1].toLowerCase() : 'allow';
    
    return {
      allowed: outboundAction === 'allow',
      action: outboundAction,
      details: stdout
    };
  } catch (error) {
    logger.warn(`Failed to check outbound status: ${error.message}`);
    return {
      allowed: true, // Default assumption
      error: error.message
    };
  }
}

/**
 * Check firewall rules for common SIP ports
 */
async function checkPortRules() {
  const commonPorts = [5060, 5061, 443]; // SIP UDP/TCP, SIP TLS, HTTPS
  
  const portRules = [];
  
  for (const port of commonPorts) {
    try {
      // Check for outbound rules on this port
      const { stdout } = await execAsync(`netsh advfirewall firewall show rule name=all | findstr /i "port=${port}"`);
      
      if (stdout && stdout.trim()) {
        portRules.push({
          port,
          hasRule: true,
          direction: 'outbound'
        });
      } else {
        portRules.push({
          port,
          hasRule: false,
          direction: 'outbound'
        });
      }
    } catch (error) {
      // No rule found or error
      portRules.push({
        port,
        hasRule: false,
        error: error.message
      });
    }
  }
  
  return portRules;
}

/**
 * Get firewall configuration instructions
 */
function getFirewallInstructions() {
  let appPath;
  try {
    appPath = app.getPath('exe');
  } catch {
    appPath = '%LOCALAPPDATA%\\Programs\\sip-toast\\SIP Toast.exe';
  }
  
  return {
    title: 'Windows Firewall Configuration',
    steps: [
      {
        title: 'Method 1: Automatic (Recommended)',
        description: 'When SIP Toast first connects, Windows Firewall will prompt you. Click "Allow access" to create the rule automatically.'
      },
      {
        title: 'Method 2: Manual Configuration',
        description: 'Add firewall rules manually:',
        details: [
          '1. Open Windows Defender Firewall',
          '2. Click "Advanced settings"',
          '3. Click "Outbound Rules" → "New Rule"',
          '4. Select "Program" → Browse to SIP Toast executable',
          '5. Select "Allow the connection"',
          '6. Apply to all profiles (Domain, Private, Public)',
          '7. Name it "SIP Toast - Outbound"'
        ]
      },
      {
        title: 'Method 3: PowerShell (Administrator)',
        description: 'Run PowerShell as Administrator and execute:',
        code: `New-NetFirewallRule -DisplayName "SIP Toast - Outbound" -Direction Outbound -Program "${appPath}" -Action Allow`
      }
    ],
    notes: [
      'SIP Toast only needs OUTBOUND connections (to connect to SIP servers and APIs)',
      'No INBOUND rules are required',
      'The application will work if outbound connections are allowed by default'
    ]
  };
}

module.exports = {
  checkFirewallStatus,
  getFirewallInstructions
};
