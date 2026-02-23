/**
 * Secure encryption utility using AES-256-GCM
 * 
 * Uses a machine-specific key derived from system properties.
 * This is reliable and works regardless of app ready state.
 * 
 * Security: The encryption key is derived from machine hostname, platform, and arch.
 * This means encrypted data can only be decrypted on the same machine.
 */

const crypto = require('crypto');
const os = require('os');

// AES-256-GCM encryption constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

// Generate a machine-specific encryption key
// This key is unique to each machine and consistent across app restarts
const getMachineKey = () => {
  // Combine multiple machine identifiers for the key
  const machineId = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || 'unknown',
    // Add a constant salt to make it harder to guess
    'sip-caller-id-encryption-key-v1'
  ].join(':');
  
  return crypto.createHash('sha256').update(machineId).digest();
};

// Cache the key for performance
let cachedKey = null;
const getEncryptionKey = () => {
  if (!cachedKey) {
    cachedKey = getMachineKey();
  }
  return cachedKey;
};

/**
 * Encrypt sensitive data using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} Encrypted text (base64 encoded with prefix)
 */
function encrypt(text) {
  if (!text || text === null || text === '') {
    return text;
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const salt = crypto.randomBytes(SALT_LENGTH);
    
    // Derive a unique key for this encryption using the salt
    const derivedKey = crypto.createHmac('sha256', key).update(salt).digest();
    
    const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const tag = cipher.getAuthTag();
    
    // Combine salt + iv + tag + encrypted data
    const combined = Buffer.concat([
      salt,
      iv,
      tag,
      Buffer.from(encrypted, 'base64')
    ]);
    
    // Prefix with 'enc:' to indicate our encryption format
    return 'enc:' + combined.toString('base64');
  } catch (error) {
    console.error('[Encryption] Encryption error:', error.message);
    // Return original text if encryption fails (should not happen)
    return text;
  }
}

/**
 * Decrypt sensitive data
 * @param {string} encryptedText - Encrypted text (base64 encoded with prefix)
 * @returns {string} Decrypted plain text
 */
function decrypt(encryptedText) {
  if (!encryptedText || encryptedText === null || encryptedText === '') {
    return encryptedText;
  }

  // Check for our new encryption format
  if (encryptedText.startsWith('enc:')) {
    try {
      const combined = Buffer.from(encryptedText.slice(4), 'base64');
      
      // Extract salt + iv + tag + encrypted data
      let offset = 0;
      const salt = combined.slice(offset, offset + SALT_LENGTH);
      offset += SALT_LENGTH;
      const iv = combined.slice(offset, offset + IV_LENGTH);
      offset += IV_LENGTH;
      const tag = combined.slice(offset, offset + TAG_LENGTH);
      offset += TAG_LENGTH;
      const encrypted = combined.slice(offset);
      
      // Derive the same key used for encryption
      const key = getEncryptionKey();
      const derivedKey = crypto.createHmac('sha256', key).update(salt).digest();
      
      const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      console.log('[Encryption] Successfully decrypted value');
      return decrypted;
    } catch (error) {
      console.error('[Encryption] Decryption error for enc: format:', error.message);
      return encryptedText;
    }
  }

  // Check if this looks like plain text (not encrypted)
  // Plain text passwords are usually shorter and don't have our prefix
  if (!encryptedText.startsWith('ss:') && !encryptedText.startsWith('fb:')) {
    // Check if it looks like base64
    const isBase64 = /^[A-Za-z0-9+/=]+$/.test(encryptedText);
    if (!isBase64 || encryptedText.length < 50) {
      // Likely plain text, return as-is
      console.log('[Encryption] Value appears to be plain text, not decrypting');
      return encryptedText;
    }
  }

  // Handle legacy formats (ss: and fb: prefixes from old versions)
  try {
    // Legacy fallback format (fb:)
    if (encryptedText.startsWith('fb:')) {
      const combined = Buffer.from(encryptedText.slice(3), 'base64');
      const key = getEncryptionKey(); // Use same machine key
      const iv = combined.slice(0, IV_LENGTH);
      const tag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);
      
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      console.log('[Encryption] Successfully decrypted legacy fallback value');
      return decrypted;
    }
    
    // Legacy safeStorage format (ss:) - won't work without safeStorage
    if (encryptedText.startsWith('ss:')) {
      console.warn('[Encryption] Cannot decrypt safeStorage format - returning as-is');
      return encryptedText;
    }
    
    // No prefix - try to decrypt as legacy format
    try {
      const combined = Buffer.from(encryptedText, 'base64');
      if (combined.length < IV_LENGTH + TAG_LENGTH) {
        // Too short to be encrypted, return as-is
        return encryptedText;
      }
      
      const key = getEncryptionKey();
      const iv = combined.slice(0, IV_LENGTH);
      const tag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
      const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);
      
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encrypted, null, 'utf8');
      decrypted += decipher.final('utf8');
      
      console.log('[Encryption] Successfully decrypted legacy value');
      return decrypted;
    } catch (legacyError) {
      // If decryption fails, assume it's plain text
      console.warn('[Encryption] Legacy decryption failed, returning as plain text');
      return encryptedText;
    }
  } catch (error) {
    console.error('[Encryption] Decryption error:', error.message);
    return encryptedText;
  }
}

/**
 * Check if encryption is available
 * @returns {boolean} Always true for our AES-256-GCM implementation
 */
function isEncryptionAvailable() {
  return true;
}

module.exports = {
  encrypt,
  decrypt,
  isEncryptionAvailable
};
