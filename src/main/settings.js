const { encrypt, decrypt } = require('./services/encryption');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// electron-store v11 uses ES modules, need to handle the import differently
let Store;
try {
  // Try default export first (v11+)
  Store = require('electron-store').default;
} catch (e) {
  // Fallback to commonjs export (v8-10)
  Store = require('electron-store');
}

// Previous application names that we should migrate from
const PREVIOUS_APP_NAMES = ['SIPToast', 'sip-toast', 'SIP-Toast', 'SIP Caller ID'];

// Fields that should be encrypted at rest
const ENCRYPTED_FIELDS = [
  'sip.password',
  'acuity.apiKey',
  'acuity.userId' // Also encrypt userId for additional security
];

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
  acuity: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', default: false },
      userId: { type: ['string', 'null'] },
      apiKey: { type: ['string', 'null'] },
    },
    default: {
      enabled: false,
      userId: null,
      apiKey: null,
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

const store = new Store({
  name: 'sip-toast',
  schema
});

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

const mergeSection = (section, patch = {}) => {
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

const save = (payload = {}) => {
  if (payload.sip) {
    const merged = mergeSection('sip', payload.sip);
    store.set('sip', encryptSensitiveFields('sip', merged));
  }

  if (payload.acuity) {
    const merged = mergeSection('acuity', payload.acuity);
    store.set('acuity', encryptSensitiveFields('acuity', merged));
  }

  if (payload.toast) {
    store.set('toast', mergeSection('toast', payload.toast));
  }

  if (payload.app) {
    store.set('app', mergeSection('app', payload.app));
  }

if (payload.updates) {
    store.set('updates', mergeSection('updates', payload.updates));
  }

  return getAll(); // Return decrypted data
};

const getWindowBounds = (name) => store.get(`windows.${name}`, null);
const setWindowBounds = (name, bounds) => {
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
  const sip = store.get('sip');
  return !!(sip && sip.server && sip.username && sip.password);
};

/**
 * Migrate settings from a previous installation
 * @returns {boolean} True if migration was successful
 */
const migrateFromPreviousVersion = () => {
  try {
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
    
    // Migrate Acuity settings
    if (oldConfig.acuity) {
      const acuityConfig = oldConfig.acuity;
      
      if (acuityConfig.userId || acuityConfig.apiKey) {
        console.log('[Settings] Migrating Acuity configuration...');
        
        // Handle encrypted fields
        let userId = acuityConfig.userId;
        let apiKey = acuityConfig.apiKey;
        
        if (typeof userId === 'string' && userId.includes(':')) {
          try {
            userId = decrypt(userId);
          } catch (e) {
            console.log('[Settings] Could not decrypt userId from old config');
          }
        }
        
        if (typeof apiKey === 'string' && apiKey.includes(':')) {
          try {
            apiKey = decrypt(apiKey);
          } catch (e) {
            console.log('[Settings] Could not decrypt apiKey from old config');
          }
        }
        
        const migratedAcuity = {
          enabled: acuityConfig.enabled || false,
          userId: userId || null,
          apiKey: apiKey || null
        };
        
        store.set('acuity', encryptSensitiveFields('acuity', migratedAcuity));
        console.log('[Settings] ✅ Acuity configuration migrated successfully');
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
 * Check for and perform migration if needed
 * Should be called early in app initialization
 */
const checkAndMigrate = () => {
  try {
    // Check if we've already attempted migration
    const migrationAttempted = store.get('migration.attempted', false);
    
    if (migrationAttempted) {
      console.log('[Settings] Migration already attempted, skipping');
      return false;
    }
    
    // Mark migration as attempted
    store.set('migration.attempted', true);
    
    // Attempt migration
    return migrateFromPreviousVersion();
  } catch (error) {
    console.error('[Settings] Error during migration check:', error.message);
    return false;
  }
};

module.exports = {
  store,
  checkAndMigrate,
  hasSipConfig,
  findPreviousConfig,
  get(key, fallback) {
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
      if (decrypted.acuity) decrypted.acuity = decryptSensitiveFields('acuity', decrypted.acuity);
      return decrypted;
    }
    
    return value;
  },
  getAll() {
    const all = store.store;
    // Decrypt all sensitive fields
    const decrypted = { ...all };
    if (decrypted.sip) {
      decrypted.sip = decryptSensitiveFields('sip', decrypted.sip);
    }
    if (decrypted.acuity) {
      decrypted.acuity = decryptSensitiveFields('acuity', decrypted.acuity);
    }
    return decrypted;
  },
  set(key, value) {
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
  },
  save,
  reset() {
    store.clear();
    return getAll(); // Return decrypted data
  },
  getWindowBounds,
  setWindowBounds
};

