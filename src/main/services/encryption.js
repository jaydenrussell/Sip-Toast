/**
 * Simple encryption utility for sensitive credentials
 * Uses AES-256-GCM for encryption with a key derived from machine-specific data
 * This provides basic protection against casual inspection of config files
 */

const crypto = require('crypto');
const os = require('os');

// Generate a machine-specific encryption key (deterministic but machine-specific)
// This ensures credentials can't be easily copied between machines
const getEncryptionKey = () => {
  const machineId = os.hostname() + os.platform() + os.arch();
  return crypto.createHash('sha256').update(machineId).digest();
};

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Encrypt sensitive data
 * @param {string} text - Plain text to encrypt
 * @returns {string} Encrypted text (base64 encoded)
 */
function encrypt(text) {
  if (!text || text === null || text === '') {
    return text;
  }

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const tag = cipher.getAuthTag();
    
    // Combine IV + tag + encrypted data
    const combined = Buffer.concat([
      iv,
      tag,
      Buffer.from(encrypted, 'base64')
    ]);
    
    return combined.toString('base64');
  } catch (error) {
    // If encryption fails, return original (fallback for compatibility)
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

  // Check if text is encrypted (base64 format with specific length)
  // If it doesn't look encrypted, return as-is (for backward compatibility)
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
    
    return decrypted;
  } catch (error) {
    // If decryption fails, assume it's plain text (backward compatibility)
    return encryptedText;
  }
}

module.exports = {
  encrypt,
  decrypt
};

