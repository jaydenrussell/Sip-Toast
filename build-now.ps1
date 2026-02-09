# PowerShell build script with explicit output
$ErrorActionPreference = "Stop"
$LogFile = "build-execution.log"

function Write-Log {
    param($Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] $Message"
    Add-Content -Path $LogFile -Value $logMessage
    Write-Host $logMessage
}

Write-Log "Starting build process..."

# Step 1: Increment version
Write-Log "Incrementing version..."
try {
    $incrementOutput = node scripts/increment-version.js 2>&1
    Write-Log "Increment output: $incrementOutput"
    
    $packageJson = Get-Content package.json | ConvertFrom-Json
    Write-Log "Version is now: $($packageJson.version)"
} catch {
    Write-Log "ERROR: Version increment failed: $_"
    exit 1
}

# Step 2: Build
Write-Log "Running electron-builder..."
try {
    $buildOutput = npx electron-builder --win 2>&1 | Out-String
    Write-Log "Build output length: $($buildOutput.Length) characters"
    Add-Content -Path $LogFile -Value "Build output: $buildOutput"
} catch {
    Write-Log "ERROR: Build failed: $_"
    exit 1
}

# Step 3: Check results
Write-Log "Checking build results..."
$msiFiles = Get-ChildItem -Path dist -Filter "*.msi" | Sort-Object LastWriteTime -Descending
$appxFiles = Get-ChildItem -Path dist -Filter "*.appx" | Sort-Object LastWriteTime -Descending

if ($msiFiles) {
    $latest = $msiFiles[0]
    Write-Log "Latest MSI: $($latest.Name) - Modified: $($latest.LastWriteTime)"
}

if ($appxFiles) {
    $latest = $appxFiles[0]
    Write-Log "Latest APPX: $($latest.Name) - Modified: $($latest.LastWriteTime)"
}

Write-Log "Build process completed. Check $LogFile for details."
