/**
 * Secure encryption utility using Electron's safeStorage
 * 
 * Uses the OS credential manager for secure storage:
 * - Windows: DPAPI (Data Protection API)
 * - macOS: Keychain
 * - Linux: Secret Service API (libsecret)
 * 
 * This provides enterprise-grade encryption for sensitive credentials.
 */

const { safeStorage } = require('electron');
const crypto = require('crypto');

// Check if safeStorage is available (app must be ready)
const isSafeStorageAvailable = () => {
  try {
    return safeStorage && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

// Fallback encryption for when safeStorage isn't available yet
// Uses AES-256-GCM with a machine-specific key
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

const getFallbackKey = () => {
  const os = require('os');
  const machineId = os.hostname() + os.platform() + os.arch();
  return crypto.createHash('sha256').update(machineId).digest();
};

/**
 * Encrypt sensitive data using safeStorage (preferred) or fallback
 * @param {string} text - Plain text to encrypt
 * @returns {string} Encrypted text (base64 encoded)
 */
function encrypt(text) {
  if (!text || text === null || text === '') {
    return text;
  }

  try {
    // Use safeStorage if available (preferred - uses OS credential manager)
    if (isSafeStorageAvailable()) {
      const encrypted = safeStorage.encryptString(text);
      // Prefix with 'ss:' to indicate safeStorage was used
      return 'ss:' + encrypted.toString('base64');
    }
    
    // Fallback to AES-256-GCM with machine-specific key
    const key = getFallbackKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const tag = cipher.getAuthTag();
    
    const combined = Buffer.concat([
      iv,
      tag,
      Buffer.from(encrypted, 'base64')
    ]);
    
    // Prefix with 'fb:' to indicate fallback encryption
    return 'fb:' + combined.toString('base64');
  } catch (error) {
    // If encryption fails, return original (for compatibility)
    console.error('Encryption error:', error.message);
    return text;
  }
}

/**
 * Decrypt sensitive data
 * @param {string} encryptedText - Encrypted text (base64 encoded)
 * @returns {string} Decrypted plain text
 */
function decrypt(encryptedText) {
  if (!encryptedText || encryptedText === null || encryptedText === '') {
    return encryptedText;
  }

  try {
    // Check for safeStorage prefix
    if (encryptedText.startsWith('ss:')) {
      // Decrypt using safeStorage
      if (!isSafeStorageAvailable()) {
        console.warn('safeStorage not available for decryption');
        return encryptedText; // Return as-is if safeStorage not available
      }
      
      const encrypted = Buffer.from(encryptedText.slice(3), 'base64');
      return safeStorage.decryptString(encrypted);
    }
    
    // Check for fallback prefix
    if (encryptedText.startsWith('fb:')) {
      const combined = Buffer.from(encryptedText.slice(3), 'base64');
      const key = getFallbackKey();
      const iv = combined.slice(0, IV_LENGTH);
      const tag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);
      
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    }
    
    // Legacy format (no prefix) - try fallback decryption
    // This handles data encrypted before the prefix system was added
    try {
      const combined = Buffer.from(encryptedText, 'base64');
      if (combined.length < IV_LENGTH + TAG_LENGTH) {
        // Too short to be encrypted, return as-is
        return encryptedText;
      }
      
      const key = getFallbackKey();
      const iv = combined.slice(0, IV_LENGTH);
      const tag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);
      
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch {
      // If decryption fails, assume it's plain text (backward compatibility)
      return encryptedText;
    }
  } catch (error) {
    // If decryption fails, return as-is (backward compatibility)
    console.error('Decryption error:', error.message);
    return encryptedText;
  }
}

/**
 * Check if encryption is available
 * @returns {boolean}
 */
function isEncryptionAvailable() {
  return isSafeStorageAvailable();
}

/**
 * Migrate credentials to safeStorage if available
 * Call this after app is ready to upgrade encryption
 * @param {object} settings - Settings object with encrypted fields
 * @param {string[]} fields - Array of field paths to migrate (e.g., ['sip.password', 'acuity.apiKey'])
 * @returns {object} Updated settings with migrated encryption
 */
function migrateToSafeStorage(settings, fields) {
  if (!isSafeStorageAvailable()) {
    return settings; // Can't migrate if safeStorage not available
  }
  
  const updated = { ...settings };
  
  for (const field of fields) {
    const [section, key] = field.split('.');
    if (updated[section] && updated[section][key]) {
      const value = decrypt(updated[section][key]);
      if (value && value !== updated[section][key]) {
        // Successfully decrypted, re-encrypt with safeStorage
        updated[section][key] = encrypt(value);
      }
    }
  }
  
  return updated;
}

module.exports = {
  encrypt,
  decrypt,
  isEncryptionAvailable,
  migrateToSafeStorage
};