/**
 * Shared phone number utilities
 * Centralized phone number normalization and formatting
 * Optimized for performance
 */

// Cache for normalized numbers to avoid repeated processing
// Reduced size for memory optimization
const normalizeCache = new Map();
const NORMALIZE_CACHE_SIZE = 500; // Reduced from 1000 to save memory

/**
 * Normalize phone number to digits only, removing leading 1 for US numbers
 * @param {string} phone - Raw phone number
 * @returns {string} Normalized phone number (10 digits for US numbers)
 */
const normalizePhone = (phone) => {
  if (!phone || typeof phone !== 'string') return '';
  
  // Security: Sanitize input - limit length to prevent DoS
  const sanitized = phone.substring(0, 50); // Max 50 characters
  
  // Check cache first
  const cached = normalizeCache.get(sanitized);
  if (cached !== undefined) {
    return cached;
  }
  
  // Use optimized regex (non-digit removal)
  const digits = sanitized.replace(/\D/g, '');
  // Security: Validate phone number length (prevent extremely long numbers)
  if (digits.length > 15) {
    return ''; // Invalid - international numbers max 15 digits
  }
  // Remove leading 1 for US numbers (11 digits -> 10 digits)
  const result = digits.startsWith('1') && digits.length === 11 ? digits.substring(1) : digits;
  
  // Cache result (with size limit) - optimized eviction
  if (normalizeCache.size >= NORMALIZE_CACHE_SIZE) {
    // Remove first entry (FIFO) - more efficient than iterating
    const firstKey = normalizeCache.keys().next().value;
    if (firstKey !== undefined) {
      normalizeCache.delete(firstKey);
    }
  }
  normalizeCache.set(phone, result);
  
  return result;
};

/**
 * Format phone number for API calls (international format)
 * @param {string} phone - Raw phone number
 * @returns {string} Formatted phone number (+1XXXXXXXXXX for US)
 */
const formatPhoneForApi = (phone) => {
  const normalized = normalizePhone(phone);
  // Format as +1XXXXXXXXXX for international format
  if (normalized.length === 10) {
    return `+1${normalized}`;
  }
  return normalized;
};

module.exports = {
  normalizePhone,
  formatPhoneForApi
};

