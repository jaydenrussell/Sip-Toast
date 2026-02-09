# SIP Toast Dependency Checker
# Run this script on the target computer to verify all dependencies are present

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SIP Toast - Dependency Checker" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allGood = $true

# Check Windows Version
Write-Host "Checking Windows Version..." -ForegroundColor Yellow
$osVersion = [System.Environment]::OSVersion.Version
$osMajor = $osVersion.Major
$osMinor = $osVersion.Minor

if ($osMajor -ge 10) {
    Write-Host "  ✓ Windows $osMajor.$osMinor detected" -ForegroundColor Green
    Write-Host "    Status: Supported" -ForegroundColor Green
} else {
    Write-Host "  ✗ Windows $osMajor.$osMinor detected" -ForegroundColor Red
    Write-Host "    Status: NOT SUPPORTED (Windows 10+ required)" -ForegroundColor Red
    $allGood = $false
}

Write-Host ""

# Check Visual C++ Redistributable
Write-Host "Checking Visual C++ Redistributable..." -ForegroundColor Yellow
$vcRedist = Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue | 
    Where-Object { $_.DisplayName -like "*Visual C++*Redistributable*" -and $_.DisplayName -like "*2015*" -or $_.DisplayName -like "*2017*" -or $_.DisplayName -like "*2019*" -or $_.DisplayName -like "*2022*" }

if ($vcRedist) {
    $vcVersions = $vcRedist | ForEach-Object { $_.DisplayName }
    Write-Host "  ✓ Visual C++ Redistributable found:" -ForegroundColor Green
    foreach ($version in $vcVersions) {
        Write-Host "    - $version" -ForegroundColor Green
    }
} else {
    Write-Host "  ⚠ Visual C++ Redistributable not found" -ForegroundColor Yellow
    Write-Host "    Download: https://aka.ms/vs/17/release/vc_redist.x64.exe" -ForegroundColor Yellow
    Write-Host "    Note: May still work if Electron runtime includes it" -ForegroundColor Yellow
}

Write-Host ""

# Check Architecture
Write-Host "Checking System Architecture..." -ForegroundColor Yellow
$arch = [System.Environment]::Is64BitOperatingSystem
if ($arch) {
    Write-Host "  ✓ 64-bit (x64) system detected" -ForegroundColor Green
} else {
    Write-Host "  ✗ 32-bit system detected" -ForegroundColor Red
    Write-Host "    Status: NOT SUPPORTED (x64 required)" -ForegroundColor Red
    $allGood = $false
}

Write-Host ""

# Check Network Connectivity
Write-Host "Checking Network Connectivity..." -ForegroundColor Yellow
try {
    $dnsTest = Test-Connection -ComputerName "google.com" -Count 1 -Quiet -ErrorAction Stop
    if ($dnsTest) {
        Write-Host "  ✓ Internet connectivity confirmed" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Internet connectivity test failed" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ⚠ Internet connectivity test failed: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "    Note: Network is required for SIP and API calls" -ForegroundColor Yellow
}

Write-Host ""

# Check Windows Firewall
Write-Host "Checking Windows Firewall..." -ForegroundColor Yellow
try {
    $firewallStatus = Get-NetFirewallProfile | Select-Object Name, Enabled
    $firewallEnabled = ($firewallStatus | Where-Object { $_.Enabled -eq $true }).Count -gt 0
    
    if ($firewallEnabled) {
        Write-Host "  ✓ Windows Firewall is enabled" -ForegroundColor Green
        
        # Check outbound rules
        $outboundRules = Get-NetFirewallRule -Direction Outbound | Where-Object { $_.Enabled -eq $true }
        $defaultOutbound = (Get-NetFirewallProfile).DefaultOutboundAction
        
        Write-Host "    Outbound default action: $defaultOutbound" -ForegroundColor Gray
        
        # Check for application-specific rules
        $appPath = "$env:LOCALAPPDATA\Programs\sip-toast\SIP Toast.exe"
        if (Test-Path $appPath) {
            $appRules = Get-NetFirewallApplicationFilter | Where-Object { $_.Program -like "*sip-toast*" -or $_.Program -like "*SIP Toast*" }
            if ($appRules) {
                Write-Host "    ✓ Application-specific firewall rules found" -ForegroundColor Green
            } else {
                Write-Host "    ⚠ No application-specific firewall rules found" -ForegroundColor Yellow
                Write-Host "      Windows will prompt when the app first connects" -ForegroundColor Gray
            }
        }
        
        # Check common ports
        $sipPorts = @(5060, 5061, 443)
        $portRules = Get-NetFirewallPortFilter | Where-Object { $_.LocalPort -in $sipPorts }
        if ($portRules) {
            Write-Host "    ✓ Port-specific firewall rules found for SIP/HTTPS" -ForegroundColor Green
        }
    } else {
        Write-Host "  ⚠ Windows Firewall is disabled" -ForegroundColor Yellow
        Write-Host "    Note: This is safe if you have other firewall software" -ForegroundColor Gray
    }
} catch {
    Write-Host "  ⚠ Unable to check firewall status: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "    Run as Administrator for detailed firewall information" -ForegroundColor Gray
}

Write-Host ""

# Check if Application is Installed
Write-Host "Checking Application Installation..." -ForegroundColor Yellow
$appPath = "$env:LOCALAPPDATA\Programs\sip-toast\SIP Toast.exe"
if (Test-Path $appPath) {
    Write-Host "  ✓ SIP Toast is installed" -ForegroundColor Green
    $versionInfo = (Get-Item $appPath).VersionInfo
    Write-Host "    Location: $appPath" -ForegroundColor Gray
    Write-Host "    File Version: $($versionInfo.FileVersion)" -ForegroundColor Gray
} else {
    Write-Host "  ⚠ SIP Toast is not installed" -ForegroundColor Yellow
    Write-Host "    Expected location: $appPath" -ForegroundColor Gray
}

Write-Host ""

# Check Application Data Directory
Write-Host "Checking Application Data..." -ForegroundColor Yellow
$appDataPath = "$env:APPDATA\sip-toast"
if (Test-Path $appDataPath) {
    Write-Host "  ✓ Application data directory exists" -ForegroundColor Green
    Write-Host "    Location: $appDataPath" -ForegroundColor Gray
    
    $configPath = Join-Path $appDataPath "config.json"
    $logPath = Join-Path $appDataPath "logs"
    
    if (Test-Path $configPath) {
        Write-Host "    ✓ Configuration file found" -ForegroundColor Green
    } else {
        Write-Host "    ⚠ Configuration file not found (will be created on first run)" -ForegroundColor Yellow
    }
    
    if (Test-Path $logPath) {
        $logFiles = Get-ChildItem $logPath -ErrorAction SilentlyContinue
        if ($logFiles) {
            Write-Host "    ✓ Log directory exists ($($logFiles.Count) log files)" -ForegroundColor Green
        } else {
            Write-Host "    ✓ Log directory exists (empty)" -ForegroundColor Green
        }
    } else {
        Write-Host "    ⚠ Log directory not found (will be created on first run)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  ⚠ Application data directory not found" -ForegroundColor Yellow
    Write-Host "    Will be created on first run: $appDataPath" -ForegroundColor Gray
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($allGood) {
    Write-Host "Status: All critical checks passed ✓" -ForegroundColor Green
} else {
    Write-Host "Status: Some issues detected ⚠" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Recommendations:" -ForegroundColor Yellow
    Write-Host "1. Ensure Windows 10 or later is installed" -ForegroundColor White
    Write-Host "2. Install Visual C++ Redistributable if missing" -ForegroundColor White
    Write-Host "3. Check application logs: $env:APPDATA\sip-toast\logs\sip-toast.log" -ForegroundColor White
}
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Offer to open log directory
if (Test-Path "$env:APPDATA\sip-toast\logs") {
    $openLogs = Read-Host "Open log directory? (Y/N)"
    if ($openLogs -eq "Y" -or $openLogs -eq "y") {
        explorer.exe "$env:APPDATA\sip-toast\logs"
    }
}
