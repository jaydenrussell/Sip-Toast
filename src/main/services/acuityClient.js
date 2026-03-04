if (typeof global.location === 'undefined') {
  global.location = { href: 'app://sip-toast' };
}

const { logger } = require('./logger');
const { get } = require('../settings');
const { normalizePhone } = require('./phoneUtils');
const fetch = require('node-fetch');

const clientCache = new Map();
const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_SIZE = 300;
const CLEANUP_INTERVAL = 3 * 60 * 1000;

let cleanupInterval = null;
const startCleanupInterval = () => {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    if (clientCache.size === 0) return;

    const now = Date.now();
    let cleaned = 0;
    let deleteCount = 0;
    const keysToDelete = [];

    for (const [key, entry] of clientCache.entries()) {
      if (entry.expiresAt <= now) {
        keysToDelete[deleteCount++] = key;
        if (deleteCount >= MAX_CACHE_SIZE) break;
      }
    }

    keysToDelete.length = deleteCount;
    for (let i = 0; i < keysToDelete.length; i++) {
      clientCache.delete(keysToDelete[i]);
      cleaned++;
    }
    keysToDelete.length = 0;

    if (clientCache.size >= MAX_CACHE_SIZE) {
      const entries = [];
      let entryCount = 0;
      for (const [key, entry] of clientCache.entries()) {
        entries[entryCount++] = { key, expiresAt: entry.expiresAt };
        if (entryCount >= MAX_CACHE_SIZE) break;
      }
      entries.length = entryCount;
      entries.sort((a, b) => a.expiresAt - b.expiresAt);
      const toRemove = Math.floor(MAX_CACHE_SIZE * 0.3);
      for (let i = 0; i < toRemove && i < entries.length; i++) {
        clientCache.delete(entries[i].key);
        cleaned++;
      }
      entries.length = 0;
    }

    if (cleaned > 0) {
      logger.debug(`🧹 Cleaned ${cleaned} expired Acuity cache entries (${clientCache.size} remaining)`);
    }

    if (clientCache.size === 0 && cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  }, CLEANUP_INTERVAL);
};

if (typeof process !== 'undefined') {
  process.on('exit', () => {
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  });
}

const apiClient = {
  async get(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'SIPCallerID',
          'Accept': 'application/vnd.github.v3+json',
          ...options.headers
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }
};

async function lookupClientByPhone(rawPhone) {
  const config = get('acuity');
  const phone = normalizePhone(rawPhone);

  if (!phone || !config.userId || !config.apiKey) {
    return { found: false, phone };
  }

  const cacheKey = `${config.userId}:${phone}`;
  const cached = clientCache.get(cacheKey);
  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  try {
    logger.info(`🔍 Querying Acuity API for phone: ${phone}`);

    const clientsResponse = await apiClient.get('https://acuityscheduling.com/api/v1/clients', {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${config.userId}:${config.apiKey}`).toString('base64')}`
      },
      timeout: 10000
    });

    if (clientsResponse.status === 400) {
      logger.error('❌ Acuity API returned 400 Bad Request');
      logger.error('   Possible issues:');
      logger.error('      • Invalid phone number format');
      logger.error('      • API endpoint or parameters are incorrect');
      return { found: false, phone, error: 'Bad Request - Invalid parameters' };
    }

    if (clientsResponse.status === 401) {
      logger.error('❌ Acuity API authentication failed (401 Unauthorized)');
      logger.error('   Please check your Acuity User ID and API Key');
      return { found: false, phone, error: 'Authentication failed - Invalid credentials' };
    }

    if (clientsResponse.status === 403) {
      logger.error('❌ Acuity API access forbidden (403)');
      logger.error('   Your API key may not have permission to access this resource');
      return { found: false, phone, error: 'Access forbidden - Insufficient permissions' };
    }

    if (clientsResponse.status !== 200) {
      logger.warn(`⚠️ Acuity API returned status ${clientsResponse.status}`);
      return { found: false, phone, error: `API returned status ${clientsResponse.status}` };
    }

    const clients = await clientsResponse.json();
    if (!Array.isArray(clients)) {
      logger.error('❌ Acuity API returned invalid response (no data)');
      return { found: false, phone, error: 'Invalid API response format' };
    }

    logger.info(`📊 Acuity API returned ${clients.length} client(s) for phone ${phone}`);

    if (clients.length === 0) {
      return { found: false, phone };
    }

    const client = clients[0];
    const clientName = client.firstName && client.lastName
      ? `${client.firstName} ${client.lastName}`
      : client.name || client.firstName || client.lastName || 'Client';

    logger.info(`✅ Found client: ${clientName} (ID: ${client.id})`);

    let appointmentTime = null;
    try {
      const appointmentsResponse = await apiClient.get('https://acuityscheduling.com/api/v1/appointments', {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${config.userId}:${config.apiKey}`).toString('base64')}`
        },
        timeout: 10000
      });

      if (appointmentsResponse.status === 400) {
        logger.warn('⚠️ Acuity API returned 400 when fetching appointments');
      } else if (appointmentsResponse.status === 401) {
        logger.warn('⚠️ Acuity API authentication failed when fetching appointments');
      } else if (appointmentsResponse.status !== 200) {
        logger.warn(`⚠️ Acuity API returned status ${appointmentsResponse.status} when fetching appointments`);
      } else {
        const appointments = await appointmentsResponse.json();
        logger.info(`📅 Found ${appointments.length} appointment(s) for client ${clientName}`);

        const now = new Date();
        const upcomingAppointments = appointments
          .filter(apt => apt.datetime && new Date(apt.datetime) > now)
          .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

        const appointment = upcomingAppointments[0];
        if (appointment) {
          appointmentTime = appointment.datetime;
          logger.info(`   Next appointment: ${appointmentTime}`);
        } else {
          logger.info('   No upcoming appointments found');
        }
      }
    } catch (aptError) {
      if (aptError.response) {
        if (aptError.response.status === 400) {
          logger.warn('⚠️ Could not fetch appointments: Bad Request (400)');
        } else if (aptError.response.status === 401) {
          logger.warn('⚠️ Could not fetch appointments: Authentication failed (401)');
        } else {
          logger.warn(`⚠️ Could not fetch appointments: ${aptError.response.status} ${aptError.response.statusText}`);
        }
      } else {
        logger.warn(`⚠️ Could not fetch appointments for client: ${aptError.message}`);
      }
    }

    const value = {
      found: true,
      phone,
      clientName,
      appointmentTime
    };

    logger.info(`✅ Acuity match: ${value.clientName}${value.appointmentTime ? ` - Next: ${value.appointmentTime}` : ''}`);

    if (clientCache.size >= MAX_CACHE_SIZE * 1.5) {
      const cleanupNow = Date.now();
      let deleteCount = 0;
      const keysToDelete = [];
      for (const [key, entry] of clientCache.entries()) {
        if (entry.expiresAt <= cleanupNow) {
          keysToDelete[deleteCount++] = key;
          if (deleteCount >= MAX_CACHE_SIZE) break;
        }
      }
      keysToDelete.length = deleteCount;
      for (let i = 0; i < keysToDelete.length; i++) {
        clientCache.delete(keysToDelete[i]);
      }
      keysToDelete.length = 0;
    }

    const now = Date.now();

    if (!cleanupInterval) {
      startCleanupInterval();
    }
    clientCache.set(cacheKey, {
      value,
      expiresAt: now + CACHE_TTL_MS
    });

    return value;
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText || '';

      logger.error(`❌ Acuity API error: ${status} ${statusText}`);

      if (status === 400) {
        logger.error('   Bad Request - Invalid parameters or request format');
        return { found: false, phone, error: 'Bad Request (400)' };
      } else if (status === 401) {
        logger.error('   Authentication failed - check your Acuity User ID and API Key');
        return { found: false, phone, error: 'Authentication failed (401)' };
      } else if (status === 403) {
        logger.error('   Access forbidden - API key may not have required permissions');
        return { found: false, phone, error: 'Access forbidden (403)' };
      } else if (status === 404) {
        logger.error('   Resource not found - API endpoint may be incorrect');
        return { found: false, phone, error: 'Not found (404)' };
      } else if (status >= 500) {
        logger.error('   Server error - Acuity API may be experiencing issues');
        return { found: false, phone, error: `Server error (${status})` };
      } else {
        return { found: false, phone, error: `API error: ${status} ${statusText}` };
      }
    } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      logger.error('❌ Acuity API request timed out');
      logger.error('   Possible issues:');
      logger.error('      • Network connectivity problems');
      logger.error('      • Acuity API is slow or unavailable');
      return { found: false, phone, error: 'Request timeout' };
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      logger.error(`❌ Acuity API connection failed: ${error.message}`);
      logger.error('   Possible issues:');
      logger.error('      • No internet connection');
      logger.error('      • DNS resolution failed');
      logger.error('      • Firewall blocking connection');
      return { found: false, phone, error: 'Connection failed' };
    } else {
      logger.error(`❌ Acuity lookup failed: ${error.message}`);
      return { found: false, phone, error: error.message };
    }
  }
}

async function testConnection() {
  const config = get('acuity');

  const results = {
    acuity: null
  };

  if (config.userId && config.apiKey) {
    try {
      logger.info('🧪 Testing Acuity API connection...');

      const testResponse = await apiClient.get('https://acuityscheduling.com/api/v1/clients', {
        headers: {
          'Authorization': `Basic ${Buffer.from(`${config.userId}:${config.apiKey}`).toString('base64')}`
        },
        timeout: 10000
      });

      if (testResponse.status === 200) {
        logger.info('✅ Acuity API connection test successful');
        results.acuity = {
          success: true,
          message: 'Acuity API connection successful',
          details: {
            status: testResponse.status,
            dataReceived: true,
            recordCount: 1
          }
        };
      } else if (testResponse.status === 400) {
        logger.error('❌ Acuity API test failed: Bad Request (400)');
        results.acuity = {
          success: false,
          message: 'Bad Request - Invalid API parameters',
          error: 'The API request format may be incorrect'
        };
      } else if (testResponse.status === 401) {
        logger.error('❌ Acuity API test failed: Authentication failed (401)');
        results.acuity = {
          success: false,
          message: 'Authentication failed',
          error: 'Invalid User ID or API Key. Please check your credentials.'
        };
      } else if (testResponse.status === 403) {
        logger.error('❌ Acuity API test failed: Access forbidden (403)');
        results.acuity = {
          success: false,
          message: 'Access forbidden',
          error: 'Your API key may not have permission to access this resource'
        };
      } else {
        logger.warn(`⚠️ Acuity API test returned status ${testResponse.status}`);
        results.acuity = {
          success: false,
          message: `API returned status ${testResponse.status}`,
          error: `Unexpected response: ${testResponse.status}`
        };
      }
    } catch (error) {
      if (error.response) {
        const status = error.response.status;
        const statusText = error.response.statusText || '';

        if (status === 400) {
          results.acuity = {
            success: false,
            message: 'Bad Request (400)',
            error: 'Invalid API request format or parameters'
          };
        } else if (status === 401) {
          results.acuity = {
            success: false,
            message: 'Authentication failed (401)',
            error: 'Invalid User ID or API Key. Please verify your credentials.'
          };
        } else if (status === 403) {
          results.acuity = {
            success: false,
            message: 'Access forbidden (403)',
            error: 'API key does not have required permissions'
          };
        } else if (status >= 500) {
          results.acuity = {
            success: false,
            message: `Server error (${status})`,
            error: 'Acuity API server is experiencing issues'
          };
        } else {
          results.acuity = {
            success: false,
            message: `API error: ${status} ${statusText}`,
            error: `Unexpected error: ${status} ${statusText}`
          };
        }
      } else if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        results.acuity = {
          success: false,
          message: 'Connection timeout',
          error: 'Request timed out. Check your internet connection and try again.'
        };
      } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        results.acuity = {
          success: false,
          message: 'Connection failed',
          error: 'Cannot reach Acuity API. Check your internet connection and firewall settings.'
        };
      } else {
        results.acuity = {
          success: false,
          message: 'Connection test failed',
          error: error.message || 'Unknown error occurred'
        };
      }
    }
  } else {
    results.acuity = {
      success: false,
      message: 'Acuity API credentials not configured',
      error: 'Missing User ID or API Key'
    };
  }

  const hasAcuity = config.userId && config.apiKey;

  let overallSuccess = false;
  let overallMessage = '';

  if (hasAcuity) {
    overallSuccess = results.acuity.success;
    overallMessage = results.acuity.message;
  } else {
    overallSuccess = false;
    overallMessage = 'Acuity API credentials not configured';
  }

  return {
    success: overallSuccess,
    message: overallMessage,
    acuity: results.acuity
  };
}

module.exports = {
  lookupClientByPhone,
  testConnection
};