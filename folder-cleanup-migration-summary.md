# SIP Caller ID - Folder Cleanup & Migration Strategy

## Problem Statement

The application has used multiple folder naming conventions over time, leading to scattered configuration folders in `%APPDATA%`:
- `SIPToast`
- `sip-toast`
- `SIP-Toast`
- `SIP Caller ID`
- `sip-callerid`
- `sip-caller-id`
- `sip-toast-nodejs`

This causes confusion, wasted disk space, and potential configuration conflicts.

## Standardized Folder Naming

**Moving forward, the application will use:** `Sip-Toast`

This is the current `electron-store` configuration in `settings.js`:
```javascript
const store = new Store({
  name: 'Sip-Toast',
  projectName: 'Sip-Toast',
  schema
});
```

## Migration Strategy

### 1. Automatic Migration on First Run

The existing `checkAndMigrate()` function in `src/main/settings.js` has been enhanced to:

- **Detect existing configurations** from all previous folder names
- **Migrate settings** (SIP, Acuity, Toast, App, Windows) to the current `sip-toast` folder
- **Handle encrypted fields** properly (passwords, API keys)
- **Preserve user data** during migration

### 2. Conditional Folder Cleanup

**New function:** `cleanupOldFolders()`

**Cleanup Logic:**
- ✅ **Only removes old folders if** the current application has **SIP configuration** (user has set up the app)
- ✅ **Preserves old folders** if no SIP config exists (in case user needs to recover data)
- ✅ **Removes all variations** of old folder names
- ✅ **Logs all actions** for audit trail

**Rationale:**
- If the user has configured SIP, they have successfully migrated and old data is no longer needed
- If the user hasn't configured SIP yet, they might need to recover data from an old installation
- Prevents accidental data loss

### 3. Migration Flow

```javascript
// On application startup
checkAndMigrate() {
  // 1. Check if migration already attempted
  // 2. Attempt to migrate from previous versions
  // 3. If migration successful OR already have SIP config:
  //    - Call cleanupOldFolders()
  // 4. Return migration status
}
```

## Implementation Details

### Updated Constants

```javascript
const PREVIOUS_APP_NAMES = [
  'SIPToast',           // Original name
  'sip-toast',          // Lowercase variant
  'SIP-Toast',          // Capitalized variant (also current)
  'SIP Caller ID',      // Full product name
  'sip-callerid',       // Alternative folder naming (no hyphen)
  'sip-caller-id',      // Alternative with hyphen
  'sip-toast-nodejs'    // Node.js specific variant
];

const CURRENT_APP_NAME = 'Sip-Toast';
```

### Folder Detection

The `findPreviousConfig()` function checks multiple paths for each old app name:

1. `{parentDir}/{oldAppName}/{oldAppName}.json`
2. `{parentDir}/{oldAppName}/config.json`
3. `{parentDir}/{oldAppName.toLowerCase()}/{oldAppName.toLowerCase()}.json`
4. `{parentDir}/{oldAppName.replace(/\s+/g, '-')}/{oldAppName.replace(/\s+/g, '-')}.json`

### Cleanup Process

```javascript
cleanupOldFolders() {
  // 1. Check if current app has SIP configuration
  if (!hasSipConfig()) {
    console.log('No SIP configuration found, skipping cleanup');
    return [];
  }

  // 2. For each old app name (excluding current):
  //    - Check if folder exists
  //    - Remove recursively if it's a directory
  //    - Log success/failure

  // 3. Also check for common variations
  //    (handles case/hyphen differences)

  // 4. Return list of cleaned folders
}
```

## Logging

All migration and cleanup activities are logged to:
- **Console output** (for debugging)
- **Installer log**: `%APPDATA%\sip-toast\logs\squirrel-install.log`
- **Application log**: `%APPDATA%\sip-toast\logs\sip-toast.log`

Example log entries:
```
[Settings] Found previous config at: C:\Users\...\AppData\Roaming\SIPToast\SIPToast.json
[Settings] Migrating SIP configuration...
[Settings] ✅ SIP configuration migrated successfully
[Settings] SIP configuration exists, cleaning up old configuration folders...
[Settings] ✅ Removed old configuration folder: C:\Users\...\AppData\Roaming\SIPToast
[Settings] 🗑️ Cleaned up 3 old configuration folder(s)
```

## Testing Checklist

### Migration Testing
- [ ] Install older version with different folder name (e.g., `SIPToast`)
- [ ] Configure SIP credentials
- [ ] Upgrade to new version
- [ ] Verify settings are migrated correctly
- [ ] Verify old folder is removed after successful migration

### Cleanup Testing
- [ ] Fresh install with SIP configured → old folders removed
- [ ] Fresh install without SIP configured → old folders preserved
- [ ] Partial migration (some settings only) → cleanup only if SIP exists
- [ ] Multiple old folders present → all removed correctly

### Edge Cases
- [ ] Old folder is a file (not directory) → handled gracefully
- [ ] Old folder in use (locked) → error logged, doesn't crash
- [ ] Permission issues → error logged, continues with other folders
- [ ] Corrupted old config → migration fails gracefully, old folder preserved

## Recommendations

### 1. Standardize on `sip-toast`
- All future versions should use this folder name consistently
- Update documentation to reflect this standard
- Communicate to users if needed (e.g., release notes)

### 2. Keep Migration Code Indefinitely
- Users may skip multiple versions
- Migration should work from any previous version
- Only remove migration code after several major releases (e.g., 2-3 years)

### 3. Monitor Logs
- Watch for migration failures in logs
- Track cleanup success rate
- Adjust logic if users report data loss

### 4. User Communication
- Add release note: "Settings automatically migrated from previous versions"
- If user reports missing settings, check logs for migration issues
- Old folders are preserved if migration fails, allowing manual recovery

## Summary

The implementation provides:
- ✅ **Comprehensive migration** from all known previous folder names
- ✅ **Safe cleanup** - only removes old folders if SIP is configured
- ✅ **Detailed logging** for troubleshooting
- ✅ **Error handling** - won't crash if cleanup fails
- ✅ **Future-proof** - handles all naming variations

This ensures a clean `%APPDATA%` structure moving forward while preserving user data during upgrades.

## Standard Folder Location

After installation, the application will store its configuration in:
```
%APPDATA%\Sip-Toast\
```

Log files will be stored in:
```
%APPDATA%\Sip-Toast\logs\
```

All previous folder names will be automatically migrated to this standard location.
