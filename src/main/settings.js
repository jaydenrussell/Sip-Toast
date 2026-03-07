const { encrypt, decrypt } = require('./services/encryption');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// electron-store v11 is an ES Module, need to use dynamic import
let Store;
let storeInstance;

// Schema definition
const schema = {
  sip: {
    type: 'object',
    properties: {
      server: { type: ['string', 'null'] },
      port: { type: ['number', 'null'] },
      transport: { type: ['string', 'null'] },
      domain: { type: ['string', 'null'] },
      username: { type: ['string', 'null'] },
      password: { type: ['string', 'null'] },
      uri: { type: ['string', 'null'] },
      displayName: { type: ['string', 'null'] }
    },
    default: {
      server: null,
      port: 5060,
      transport: 'udp',
      domain: null,
      username: null,
      password: null,
      uri: null,
      displayName: null
    }
  },
  toast: {
    type: 'object',
    properties: {
      autoDismissMs: { type: 'number', default: 20000 },
      numberFont: { type: 'string', default: 'Segoe UI Variable, Segoe UI, sans-serif' },
      numberFontSize: { type: 'number', default: 15 },
      numberColor: { type: 'string', default: '#FFFFFF' },
      callerIdFont: { type: 'string', default: 'Segoe UI Variable, Segoe UI, sans-serif' },
      callerIdFontSize: { type: 'number', default: 20 },
      callerIdColor: { type: 'string', default: '#FFFFFF' }
    },
    default: {
      autoDismissMs: 20000,
      numberFont: 'Segoe UI Variable, Segoe UI, sans-serif',
      numberFontSize: 15,
      numberColor: '#FFFFFF',
      callerIdFont: 'Segoe UI Variable, Segoe UI, sans-serif',
      callerIdFontSize: 20,
      callerIdColor: '#FFFFFF'
    }
  },
  app: {
    type: 'object',
    properties: {
      launchAtLogin: { type: 'boolean', default: true }
    },
    default: {
      launchAtLogin: true
    }
  },
  updates: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: true },
      checkFrequency: { type: 'string', default: 'daily' }, // 'daily', 'weekly', 'monthly', 'never'
      lastCheckTime: { type: ['string', 'null'], default: null }
    },
    default: {
      enabled: true,
      checkFrequency: 'daily',
      lastCheckTime: null
    }
  },
  windows: {
    type: 'object',
    properties: {
      tray: {
        type: ['object', 'null'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' }
        },
        default: null
      },
      toast: {
        type: ['object', 'null'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' }
        },
        default: null
      }
    },
    default: {}
  }
};

// Previous application names and folder names that we should migrate from
// These represent different naming conventions used in previous versions
const PREVIOUS_APP_NAMES = [
  'SIPToast',           // Original name
  'sip-toast',          // Previous project name
  'SIP-Toast',          // Capitalized variant
  'Sip-Toast',          // Previous standard name
  'sip-callerid',       // Alternative folder naming (no hyphen)
  'sip-caller-id',      // Alternative with hyphen
  'sip-toast-nodejs'    // Node.js specific variant
];

// The standard folder name to use moving forward
const CURRENT_APP_NAME = 'SIP Caller ID';

// Fields that should be encrypted at rest
const ENCRYPTED_FIELDS = [
  'sip.password'
];

// Encrypt sensitive fields before storing
const encryptSensitiveFields = (section, data) => {
  if (!data || typeof data !== 'object') return data;
  
  const encrypted = { ...data };
  for (const field of ENCRYPTED_FIELDS) {
    const [fieldSection, fieldKey] = field.split('.');
    if (fieldSection === section && encrypted[fieldKey] && encrypted[fieldKey] !== null) {
      encrypted[fieldKey] = encrypt(encrypted[fieldKey]);
    }
  }
  return encrypted;
};

// Decrypt sensitive fields after retrieving
const decryptSensitiveFields = (section, data) => {
  if (!data || typeof data !== 'object') return data;
  
  const decrypted = { ...data };
  for (const field of ENCRYPTED_FIELDS) {
    const [fieldSection, fieldKey] = field.split('.');
    if (fieldSection === section && decrypted[fieldKey] && decrypted[fieldKey] !== null) {
      const originalValue = decrypted[fieldKey];
      try {
        decrypted[fieldKey] = decrypt(originalValue);
        // Log if decryption changed the value
        if (decrypted[fieldKey] !== originalValue) {
          console.log(`[Settings] Decrypted ${fieldKey} (length: ${originalValue.length} -> ${decrypted[fieldKey].length})`);
        }
      } catch (error) {
        console.error(`[Settings] Failed to decrypt ${fieldKey}:`, error.message);
        // Keep original value if decryption fails
      }
    }
  }
  return decrypted;
};

const mergeSection = async (section, patch = {}) => {
  const store = getStore();
  const existing = store.get(section);
  const decrypted = decryptSensitiveFields(section, existing);
  
  // Debug logging for password handling
  if (section === 'sip') {
    const hasExistingPassword = !!(decrypted && decrypted.password);
    const hasNewPassword = !!(patch && patch.password);
    console.log(`[Settings] mergeSection sip - existing password: ${hasExistingPassword}, new password: ${hasNewPassword}`);
  }
  
  return {
    ...decrypted,
    ...patch
  };
};

const save = async (payload = {}) => {
  const store = getStore();
  if (payload.sip) {
    const merged = await mergeSection('sip', payload.sip);
    store.set('sip', encryptSensitiveFields('sip', merged));
  }

  if (payload.toast) {
    const merged = await mergeSection('toast', payload.toast);
    store.set('toast', merged);
  }

  if (payload.app) {
    const merged = await mergeSection('app', payload.app);
    store.set('app', merged);
  }

  if (payload.updates) {
    const merged = await mergeSection('updates', payload.updates);
    store.set('updates', merged);
  }

  return getAll(); // Return decrypted data
};

const getWindowBounds = (name) => {
  const store = getStore();
  return store.get(`windows.${name}`, null);
};

const setWindowBounds = (name, bounds) => {
  const store = getStore();
  if (bounds && typeof bounds.x === 'number' && typeof bounds.y === 'number') {
    // Save position (x, y) and optionally size (width, height)
    const boundsToSave = {
      x: bounds.x,
      y: bounds.y
    };
    if (typeof bounds.width === 'number' && typeof bounds.height === 'number') {
      boundsToSave.width = bounds.width;
      boundsToSave.height = bounds.height;
    }
    store.set(`windows.${name}`, boundsToSave);
  }
};

/**
 * Find the config file from a previous installation
 * @returns {string|null} Path to the old config file, or null if not found
 */
const findPreviousConfig = () => {
  try {
    const userDataPath = app.getPath('userData');
    const parentDir = path.dirname(userDataPath);
    
    // Check each possible previous app name
    for (const oldAppName of PREVIOUS_APP_NAMES) {
      // Check for config files in various possible locations
      const possiblePaths = [
        // Standard electron-store location
        path.join(parentDir, oldAppName, `${oldAppName}.json`),
        // Alternative naming
        path.join(parentDir, oldAppName, 'config.json'),
        // Lowercase version
        path.join(parentDir, oldAppName.toLowerCase(), `${oldAppName.toLowerCase()}.json`),
        // With hyphens
        path.join(parentDir, oldAppName.replace(/\s+/g, '-'), `${oldAppName.replace(/\s+/g, '-')}.json`),
      ];
      
      for (const configPath of possiblePaths) {
        if (fs.existsSync(configPath)) {
          console.log(`[Settings] Found previous config at: ${configPath}`);
          return configPath;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('[Settings] Error finding previous config:', error.message);
    return null;
  }
};

/**
 * Check if current settings have any SIP configuration
 * @returns {boolean} True if SIP is configured
 */
const hasSipConfig = () => {
  try {
    const store = getStore();
    const sip = store.get('sip');
    return !!(sip && sip.server && sip.username && sip.password);
  } catch (error) {
    console.error('[Settings] Error checking SIP config:', error.message);
    return false;
  }
};

/**
 * Migrate settings from a previous installation
 * @returns {boolean} True if migration was successful
 */
const migrateFromPreviousVersion = () => {
  try {
    const store = getStore();
    // Check if we already have SIP configuration
    if (hasSipConfig()) {
      console.log('[Settings] Already have SIP configuration, skipping migration');
      return false;
    }
    
    // Find previous config file
    const oldConfigPath = findPreviousConfig();
    if (!oldConfigPath) {
      console.log('[Settings] No previous configuration found');
      return false;
    }
    
    // Read and parse the old config
    const oldConfigData = fs.readFileSync(oldConfigPath, 'utf8');
    const oldConfig = JSON.parse(oldConfigData);
    
    if (!oldConfig) {
      console.log('[Settings] Previous config is empty or invalid');
      return false;
    }
    
    console.log('[Settings] Migrating from previous installation...');
    
    // Migrate SIP settings
    if (oldConfig.sip) {
      const sipConfig = oldConfig.sip;
      
      // Check if the old config has meaningful SIP data
      if (sipConfig.server && sipConfig.username && sipConfig.password) {
        console.log('[Settings] Migrating SIP configuration...');
        console.log(`[Settings]   Server: ${sipConfig.server}`);
        console.log(`[Settings]   Username: ${sipConfig.username}`);
        
        // Handle password - it might be encrypted with a different key
        let password = sipConfig.password;
        
        // Try to decrypt if it looks encrypted (base64 string with specific format)
        if (typeof password === 'string' && password.includes(':')) {
          try {
            // Try decryption with current encryption
            password = decrypt(password);
          } catch (e) {
            // If decryption fails, the password might be stored in a different format
            // or not encrypted at all - use it as-is
            console.log('[Settings] Could not decrypt password from old config, using as-is');
          }
        }
        
        // Save the migrated SIP config
        const migratedSip = {
          server: sipConfig.server || null,
          port: sipConfig.port || 5060,
          transport: sipConfig.transport || 'udp',
          domain: sipConfig.domain || null,
          username: sipConfig.username || null,
          password: password,
          uri: sipConfig.uri || null,
          displayName: sipConfig.displayName || null
        };
        
        store.set('sip', encryptSensitiveFields('sip', migratedSip));
        console.log('[Settings] ✅ SIP configuration migrated successfully');
      }
    }
    
    
    // Migrate toast settings
    if (oldConfig.toast) {
      console.log('[Settings] Migrating toast display settings...');
      store.set('toast', oldConfig.toast);
    }
    
    // Migrate app settings
    if (oldConfig.app) {
      console.log('[Settings] Migrating app settings...');
      store.set('app', oldConfig.app);
    }
    
    // Migrate window positions
    if (oldConfig.windows) {
      console.log('[Settings] Migrating window positions...');
      store.set('windows', oldConfig.windows);
    }
    
    console.log('[Settings] ✅ Migration completed successfully');
    return true;
    
  } catch (error) {
    console.error('[Settings] Migration failed:', error.message);
    return false;
  }
};

/**
 * Clean up old configuration folders after successful migration
 * Only removes folders if current app has SIP configuration (meaning user has set up the app)
 */
const cleanupOldFolders = () => {
  try {
    const userDataPath = app.getPath('userData');
    const parentDir = path.dirname(userDataPath);
    let cleanedFolders = [];
    
    // Check if we have SIP configuration - only clean if user has configured SIP
    const hasSip = hasSipConfig();
    if (!hasSip) {
      console.log('[Settings] No SIP configuration found, skipping folder cleanup (preserving old data for potential migration)');
      return cleanedFolders;
    }
    
    console.log('[Settings] SIP configuration exists, cleaning up old configuration folders...');
    
    // Check each possible old app name folder
    for (const oldAppName of PREVIOUS_APP_NAMES) {
      // Skip the current app name
      if (oldAppName === CURRENT_APP_NAME) continue;
      
      const oldFolderPath = path.join(parentDir, oldAppName);
      
      // Check if the folder exists
      if (fs.existsSync(oldFolderPath)) {
        try {
          // Check if it's a directory
          const stat = fs.statSync(oldFolderPath);
          if (stat.isDirectory()) {
            // Remove the entire folder and its contents
            fs.rmSync(oldFolderPath, { recursive: true, force: true });
            console.log(`[Settings] ✅ Removed old configuration folder: ${oldFolderPath}`);
            cleanedFolders.push(oldFolderPath);
          }
        } catch (error) {
          console.error(`[Settings] Failed to remove folder ${oldFolderPath}:`, error.message);
        }
      }
    }
    
    // Also check for variations with different casing/hyphens
    const variationsToCheck = [
      'SIPToast',
      'SIP-Toast',
      'SIP Caller ID',
      'sip-callerid',
      'sip-caller-id',
      'sip-toast-nodejs'
    ];
    
    for (const variation of variationsToCheck) {
      if (variation === CURRENT_APP_NAME) continue;
      
      const variationPath = path.join(parentDir, variation);
      if (fs.existsSync(variationPath) && !cleanedFolders.includes(variationPath)) {
        try {
          const stat = fs.statSync(variationPath);
          if (stat.isDirectory()) {
            fs.rmSync(variationPath, { recursive: true, force: true });
            console.log(`[Settings] ✅ Removed old configuration folder: ${variationPath}`);
            cleanedFolders.push(variationPath);
          }
        } catch (error) {
          console.error(`[Settings] Failed to remove folder ${variationPath}:`, error.message);
        }
      }
    }
    
    if (cleanedFolders.length > 0) {
      console.log(`[Settings] 🗑️ Cleaned up ${cleanedFolders.length} old configuration folder(s)`);
    } else {
      console.log('[Settings] No old configuration folders found to clean up');
    }
    
    return cleanedFolders;
  } catch (error) {
    console.error('[Settings] Error during folder cleanup:', error.message);
    return [];
  }
};

/**
 * Check for and perform migration if needed
 * Should be called early in app initialization
 */
const checkAndMigrate = () => {
  try {
    const store = getStore();
    // Check if we've already attempted migration
    const migrationAttempted = store.get('migration.attempted', false);
    
    if (migrationAttempted) {
      console.log('[Settings] Migration already attempted, skipping');
      return false;
    }
    
    // Mark migration as attempted
    store.set('migration.attempted', true);
    
    // Attempt migration
    const migrated = migrateFromPreviousVersion();
    
    // If migration was successful or we already have SIP config, clean up old folders
    if (migrated || hasSipConfig()) {
      cleanupOldFolders();
    }
    
    return migrated;
  } catch (error) {
    console.error('[Settings] Error during migration check:', error.message);
    return false;
  }
};

// Async function to initialize the store
async function initStore() {
  if (!Store) {
    // Dynamic import for ES Module
    const electronStoreModule = await import('electron-store');
    Store = electronStoreModule.default;
  }
  
  if (!storeInstance) {
    storeInstance = new Store({
      name: 'SIP Caller ID',
      projectName: 'SIP Caller ID',
      schema
    });
  }
  
  return storeInstance;
}

// Export a getter function that ensures the store is initialized
function getStore() {
  if (!storeInstance) {
    throw new Error('Store not initialized. Call initStore() first.');
  }
  return storeInstance;
}

// Export functions
module.exports = {
  initStore,
  getStore,
  checkAndMigrate,
  hasSipConfig,
  findPreviousConfig,
  get(key, fallback) {
    try {
      const store = getStore();
      const value = store.get(key, fallback);
      
      // Handle null/undefined
      if (value === null || value === undefined) {
        return fallback;
      }
      
      // Decrypt if this is a sensitive field (e.g., 'sip.password')
      if (typeof key === 'string' && key.includes('.')) {
        const [section, ...fieldParts] = key.split('.');
        const fieldKey = fieldParts.join('.');
        const fieldPath = `${section}.${fieldKey}`;
        
        if (ENCRYPTED_FIELDS.includes(fieldPath) && typeof value === 'string') {
          try {
            return decrypt(value);
          } catch (e) {
            // If decryption fails, value might not be encrypted (legacy)
            return value;
          }
        }
        return value;
      }
      
      // If getting a section (e.g., 'sip'), decrypt sensitive fields
      if (typeof key === 'string' && !key.includes('.') && typeof value === 'object') {
        return decryptSensitiveFields(key, value);
      }
      
      // If getting all settings (no key or root), decrypt all sections
      if (typeof key !== 'string' && value && typeof value === 'object') {
        const decrypted = { ...value };
        if (decrypted.sip) decrypted.sip = decryptSensitiveFields('sip', decrypted.sip);
        return decrypted;
      }
      
      return value;
    } catch (error) {
      console.error(`[Settings] Error getting value for key ${key}:`, error.message);
      return fallback;
    }
  },
  getAll() {
    try {
      const store = getStore();
      const all = store.store;
      // Decrypt all sensitive fields
      const decrypted = { ...all };
      if (decrypted.sip) {
        decrypted.sip = decryptSensitiveFields('sip', decrypted.sip);
      }
      return decrypted;
    } catch (error) {
      console.error('[Settings] Error getting all values:', error.message);
      return {};
    }
  },
  set(key, value) {
    try {
      const store = getStore();
      // Encrypt if this is a sensitive field
      let valueToStore = value;
      if (typeof key === 'string' && key.includes('.')) {
        const [section, fieldKey] = key.split('.');
        const fieldPath = `${section}.${fieldKey}`;
        if (ENCRYPTED_FIELDS.includes(fieldPath) && value && value !== null) {
          valueToStore = encrypt(value);
        }
      }
      store.set(key, valueToStore);
    } catch (error) {
      console.error(`[Settings] Error setting value for key ${key}:`, error.message);
    }
  },
  save,
  reset() {
    try {
      const store = getStore();
      store.clear();
      return getAll(); // Return decrypted data
    } catch (error) {
      console.error('[Settings] Error resetting store:', error.message);
      return {};
    }
  },
  getWindowBounds,
  setWindowBounds
};
