const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { app } = require('electron');
const { logger } = require('./logger');

const execAsync = promisify(exec);

// Cache for firewall results (5 minute TTL)
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Get cached result or compute new one (handles async properly)
 */
const getCachedResult = async (key, computeFn) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }
  const result = await computeFn();
  cache.set(key, { value: result, timestamp: Date.now() });
  return result;
};

/**
 * Check Windows Firewall configuration for SIP Toast
 * Optimized: parallel execution and caching
 */
async function checkFirewallStatus() {
  return await getCachedResult('firewallStatus', async () => {
    const results = {
      firewallEnabled: false,
      outboundAllowed: true,
      inboundAllowed: false,
      appRules: [],
      portRules: [],
      recommendations: [],
      status: 'unknown',
      details: {}
    };

    try {
      // Parallel firewall checks for better performance
      const [firewallStatus, appRules, outboundStatus, portRules] = await Promise.all([
        checkFirewallEnabled(),
        checkApplicationRules(),
        checkOutboundStatus(),
        checkPortRules()
      ]);

      results.firewallEnabled = firewallStatus.enabled;
      results.details.firewallStatus = firewallStatus;
      results.appRules = appRules;
      results.outboundAllowed = outboundStatus.allowed;
      results.portRules = portRules;

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
  });
}

/**
 * Check if Windows Firewall is enabled
 */
async function checkFirewallEnabled() {
  try {
    const { stdout } = await execAsync('netsh advfirewall show allprofiles state', { timeout: 5000 });
    return { enabled: stdout.includes('ON'), details: stdout };
  } catch (error) {
    return { enabled: null, error: error.message };
  }
}

/**
 * Check for application-specific firewall rules - optimized single query
 */
async function checkApplicationRules() {
  try {
    const appPath = getAppPath();
    const appName = path.basename(appPath, '.exe');
    
    // Try PowerShell first (more reliable, faster timeout)
    try {
      const escapedName = appName.replace(/'/g, "''");
      const psCmd = `Get-NetFirewallRule -DisplayName -like "*${escapedName}*" -Program "${appPath}" | Select-Object DisplayName,Enabled,Direction,Action | ConvertTo-Json -Compress`;
      const { stdout } = await execAsync(`powershell -ExecutionPolicy Bypass -Command "${psCmd}"`, { timeout: 8000 });
      
      if (stdout?.trim() && stdout !== '[]') {
        try {
          const rules = JSON.parse(stdout);
          const ruleArray = Array.isArray(rules) ? rules : [rules];
          return ruleArray.map(rule => ({
            name: rule.DisplayName || 'Unknown',
            enabled: rule.Enabled === true || rule.Enabled === 'True',
            direction: (rule.Direction || 'Outbound').toLowerCase(),
            action: (rule.Action || 'Allow').toLowerCase()
          }));
        } catch { /* Parse error, continue to netsh */ }
      }
    } catch { /* PowerShell failed */ }

    // Fallback to netsh
    try {
      const { stdout } = await execAsync(`netsh advfirewall firewall show rule name=all | findstr /i "${appName}"`, { timeout: 5000 });
      const rules = [];
      if (stdout?.trim()) {
        for (const line of stdout.split('\n')) {
          if (line.includes('Rule Name:')) {
            const name = line.split('Rule Name:')[1]?.trim();
            if (name) {
              rules.push({ name, enabled: true, direction: 'outbound', action: 'allow' });
            }
          }
        }
      }
      return rules;
    } catch (error) {
      return error.code === 1 ? [] : [];
    }
  } catch (error) {
    return [];
  }
}

/**
 * Check outbound firewall status
 */
async function checkOutboundStatus() {
  try {
    const { stdout } = await execAsync('netsh advfirewall show allprofiles firewallpolicy', { timeout: 5000 });
    const match = stdout.match(/Outbound.*?Action:\s*(\w+)/i);
    return { allowed: (match ? match[1].toLowerCase() : 'allow') === 'allow', action: match?.[1]?.toLowerCase() };
  } catch (error) {
    return { allowed: true, error: error.message };
  }
}

/**
 * Check firewall rules for common SIP ports - optimized parallel check
 */
async function checkPortRules() {
  const commonPorts = [5060, 5061, 443];
  
  // Check all ports in parallel
  const results = await Promise.all(commonPorts.map(async (port) => {
    try {
      const { stdout } = await execAsync(`netsh advfirewall firewall show rule name=all | findstr /i "port=${port}"`, { timeout: 3000 });
      return { port, hasRule: !!stdout?.trim(), direction: 'outbound' };
    } catch {
      return { port, hasRule: false, direction: 'outbound' };
    }
  }));
  
  return results;
}

/**
 * Get app executable path safely
 */
const getAppPath = () => {
  try {
    return app.getPath('exe') || process.execPath;
  } catch {
    return process.execPath;
  }
};

/**
 * Get firewall configuration instructions
 */
function getFirewallInstructions() {
  const appPath = getAppPath();
  
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
