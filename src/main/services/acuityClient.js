if (typeof global.location === 'undefined') {
  global.location = { href: 'app://sip-toast' };
}

const axios = require('axios');
const { logger } = require('./logger');
const { get } = require('../settings');
const { normalizePhone } = require('./phoneUtils');

// Optimized cache settings for memory efficiency
const clientCache = new Map();
const CACHE_TTL_MS = 30 * 1000; // Reduced to 30 seconds
const MAX_CACHE_SIZE = 100; // Reduced from 300
const CLEANUP_INTERVAL = 2 * 60 * 1000; // 2 minutes

// Create optimized axios instance
const apiClient = axios.create({
  timeout: 8000, // Reduced timeout
  validateStatus: (status) => status < 500
});

// Lazy-start cleanup interval
let cleanupInterval = null;

const startCleanupInterval = () => {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    if (clientCache.size === 0) return;
    
    const now = Date.now();
    let cleaned = 0;
    
    // Fast cleanup - remove expired entries
    for (const [key, entry] of clientCache.entries()) {
      if (entry.expiresAt <= now) {
        clientCache.delete(key);
        cleaned++;
      }
    }
    
    // If still too large, trim to max size
    if (clientCache.size >= MAX_CACHE_SIZE) {
      let removed = 0;
      const targetSize = Math.floor(MAX_CACHE_SIZE * 0.7);
      for (const [key] of clientCache) {
        if (clientCache.size <= targetSize) break;
        clientCache.delete(key);
        removed++;
      }
      cleaned += removed;
    }
    
    if (cleaned > 0) {
      logger.debug(`🧹 Cleaned ${cleaned} Acuity cache entries (${clientCache.size} remaining)`);
    }
    
    // Stop if empty
    if (clientCache.size === 0 && cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  }, CLEANUP_INTERVAL);
};

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('exit', () => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  });
}

async function lookupClientByPhone(rawPhone) {
  const config = get('acuity');
  const phone = normalizePhone(rawPhone);

  if (!phone || !config.userId || !config.apiKey) {
    return { found: false, phone };
  }

  const cacheKey = `${config.userId}:${phone}`;
  const now = Date.now();
  const cached = clientCache.get(cacheKey);
  
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    logger.info(`🔍 Querying Acuity API for phone: ${phone}`);
    
    // Single API call with parallel appointment lookup
    const clientsResponse = await apiClient.get('https://acuityscheduling.com/api/v1/clients', {
      params: { phone },
      auth: { username: config.userId, password: config.apiKey }
    });

    if (clientsResponse.status !== 200 || !clientsResponse.data?.length) {
      return { found: false, phone };
    }

    const client = clientsResponse.data[0];
    const clientName = client.firstName && client.lastName
      ? `${client.firstName} ${client.lastName}`
      : client.name || client.firstName || 'Client';

    logger.info(`✅ Found client: ${clientName}`);

    // Lookup appointments
    let appointmentTime = null;
    try {
      const aptResponse = await apiClient.get('https://acuityscheduling.com/api/v1/appointments', {
        params: { clientID: client.id },
        auth: { username: config.userId, password: config.apiKey }
      });

      if (aptResponse.status === 200 && aptResponse.data?.length) {
        const nowDate = new Date();
        const upcoming = aptResponse.data
          .filter(apt => apt.datetime && new Date(apt.datetime) > nowDate)
          .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));
        
        if (upcoming[0]) {
          appointmentTime = upcoming[0].datetime;
          logger.info(`   Next appointment: ${appointmentTime}`);
        }
      }
    } catch { /* Appointment lookup failed, continue without */ }

    const value = { found: true, phone, clientName, appointmentTime };

    // Cache with lazy cleanup start
    if (!cleanupInterval) startCleanupInterval();
    
    // Trim cache if needed
    if (clientCache.size >= MAX_CACHE_SIZE) {
      let removed = 0;
      for (const [key] of clientCache) {
        if (clientCache.size <= Math.floor(MAX_CACHE_SIZE * 0.7)) break;
        clientCache.delete(key);
        removed++;
      }
    }
    
    clientCache.set(cacheKey, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
    
  } catch (error) {
    const status = error.response?.status;
    const msg = error.response?.statusText || error.message;
    
    if (status === 401) return { found: false, phone, error: 'Authentication failed' };
    if (status === 404) return { found: false, phone, error: 'Client not found' };
    if (status >= 500) return { found: false, phone, error: `Server error (${status})` };
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return { found: false, phone, error: 'Request timeout' };
    }
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      return { found: false, phone, error: 'Connection failed' };
    }
    
    logger.error(`❌ Acuity lookup failed: ${msg}`);
    return { found: false, phone, error: msg };
  }
}

async function testConnection() {
  const config = get('acuity');
  
  if (!config.userId || !config.apiKey) {
    return { success: false, message: 'Acuity API credentials not configured', error: 'Missing credentials' };
  }

  try {
    logger.info('🧪 Testing Acuity API connection...');
    
    const testResponse = await apiClient.get('https://acuityscheduling.com/api/v1/clients', {
      params: { limit: 1 },
      auth: { username: config.userId, password: config.apiKey }
    });

    if (testResponse.status === 200) {
      return { success: true, message: 'Acuity API connection successful' };
    }
    if (testResponse.status === 401) {
      return { success: false, message: 'Authentication failed', error: 'Invalid credentials' };
    }
    return { success: false, message: `API returned status ${testResponse.status}` };
    
  } catch (error) {
    const status = error.response?.status;
    if (status === 401) {
      return { success: false, message: 'Authentication failed', error: 'Invalid credentials' };
    }
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return { success: false, message: 'Connection timeout', error: 'Request timed out' };
    }
    return { success: false, message: 'Connection failed', error: error.message };
  }
}

module.exports = { lookupClientByPhone, testConnection };
