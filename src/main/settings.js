const Store = require('electron-store');
const { encrypt, decrypt } = require('./services/encryption');

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
      callerIdFont: { type: 'string', default: 'Segoe UI Variable, Segoe UI, sans-serif' },
      callerIdFontSize: { type: 'number', default: 20 }
    },
    default: {
      autoDismissMs: 20000,
      numberFont: 'Segoe UI Variable, Segoe UI, sans-serif',
      numberFontSize: 15,
      callerIdFont: 'Segoe UI Variable, Segoe UI, sans-serif',
      callerIdFontSize: 20
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
      decrypted[fieldKey] = decrypt(decrypted[fieldKey]);
    }
  }
  return decrypted;
};

const mergeSection = (section, patch = {}) => {
  const existing = store.get(section);
  const decrypted = decryptSensitiveFields(section, existing);
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

module.exports = {
  store,
  get(key, fallback) {
    const value = store.get(key, fallback);
    // Decrypt if this is a sensitive field
    if (typeof key === 'string' && key.includes('.')) {
      const [section, ...fieldParts] = key.split('.');
      const fieldKey = fieldParts.join('.');
      const fieldPath = `${section}.${fieldKey}`;
      
      // Handle nested objects (e.g., 'sip.password')
      if (ENCRYPTED_FIELDS.includes(fieldPath)) {
        if (value && value !== null && typeof value === 'string') {
          return decrypt(value);
        }
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        // If getting a section, decrypt all sensitive fields in that section
        return decryptSensitiveFields(section, value);
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // If getting root level, decrypt all sections
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

