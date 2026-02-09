const EventEmitter = require('eventemitter3');
const sip = require('sip');
const digest = require('sip/digest');
const { logger } = require('../services/logger');
const dns = require('dns').promises;
const { URL } = require('url');
const os = require('os');

class SipManager extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.sipStack = null;
    this.registrationTimer = null;
    this.reconnectTimeout = null;
    this.state = 'idle';
    this.registrationSession = null;
    this.serverHost = null;
    this.serverPort = 5060;
    this.localPort = 5060;
  }

  async updateConfig(nextConfig) {
    logger.info('SIP configuration updated');
    this.config = nextConfig;
    await this.start();
  }

  async _checkServerReachability(server) {
    try {
      // Parse server - could be domain:port or just domain
      let hostname = server;
      let port = 5060;
      
      if (server.includes(':')) {
        const parts = server.split(':');
        hostname = parts[0];
        port = parseInt(parts[1]) || 5060;
      }
      
      // Remove protocol if present
      hostname = hostname.replace(/^sips?:\/\//, '');
      
      logger.info(`🔍 Checking server reachability: ${hostname}:${port}`);
      
      // Try DNS lookup
      try {
        await Promise.race([
          dns.lookup(hostname),
          new Promise((_, reject) => setTimeout(() => reject(new Error('DNS lookup timeout')), 3000))
        ]);
        logger.info(`✅ DNS lookup successful for ${hostname}`);
        return { reachable: true, error: null, hostname, port };
      } catch (dnsError) {
        logger.error(`❌ DNS lookup failed for ${hostname}: ${dnsError.message}`);
        return { 
          reachable: false, 
          error: `Server ${hostname} is not reachable. DNS lookup failed. Check your internet connection and server address.`,
          hostname,
          port
        };
      }
    } catch (error) {
      logger.error(`❌ Invalid server address format: ${error.message}`);
      return { 
        reachable: false, 
        error: `Invalid server address format. Expected format: server.example.com or server.example.com:5060` 
      };
    }
  }

  _parseServerAddress(server) {
    if (!server) return null;
    
    // Remove protocol if present
    let address = server.replace(/^sips?:\/\//, '').replace(/^wss?:\/\//, '');
    
    // Extract hostname and port
    let hostname = address;
    let port = 5060;
    
    if (address.includes(':')) {
      const parts = address.split(':');
      hostname = parts[0];
      port = parseInt(parts[1]) || 5060;
    }
    
    // Remove path if present (e.g., /ws)
    hostname = hostname.split('/')[0];
    
    return { hostname, port };
  }

  async start() {
    logger.info(`🔄 Starting SIP manager (current state: ${this.state}, stack: ${!!this.sipStack})`);
    
    // Stop existing connection cleanly
    this.stop();
    
    // Small delay to ensure clean shutdown
    await new Promise(resolve => setTimeout(resolve, 500));

    if (!this._hasCredentials()) {
      logger.warn('❌ SIP credentials are incomplete; SipManager not started.');
      logger.warn(`   Missing: server=${!!this.config?.server}, username=${!!this.config?.username}, password=${!!this.config?.password}`);
      logger.warn('   Please check: Server, Port, Username, and Password fields');
      this._setState('idle', { reason: 'missing-credentials' });
      return;
    }

    // Parse server address
    const serverInfo = this._parseServerAddress(this.config.server);
    if (!serverInfo) {
      logger.error('❌ Invalid server address');
      this._setState('error', { cause: 'Invalid server address' });
      return;
    }

    this.serverHost = serverInfo.hostname;
    this.serverPort = serverInfo.port;

    logger.info(`🚀 Starting native SIP connection to ${this.serverHost}:${this.serverPort}`);
    logger.info(`   SIP URI: ${this.config.uri}`);
    logger.info(`   Username: ${this.config.username || 'N/A'}`);
    logger.info(`   Port: ${this.config.port || 5060}`);
    
    // Check server reachability first
    const reachability = await this._checkServerReachability(this.config.server);
    if (!reachability.reachable) {
      logger.error(`❌ ${reachability.error}`);
      this._setState('error', { cause: reachability.error });
      return;
    }

    this.serverHost = reachability.hostname;
    this.serverPort = reachability.port;
    
    // Set connection timeout
    const connectionTimeout = setTimeout(() => {
      if (this.state === 'registering') {
        logger.error('⏱️ SIP connection timeout - server did not respond within 15 seconds');
        logger.error('   Possible issues:');
        logger.error('   1. Server is not accessible (check firewall/network)');
        logger.error('   2. Incorrect server address or port');
        logger.error('   3. Username, login, or password is incorrect');
        logger.error('   4. Server requires different authentication method');
        this._setState('error', { cause: 'Connection timeout - server did not respond' });
        this.stop();
      }
    }, 15000);
    
    try {
      // Configure transport based on selection
      const transport = this.config.transport || 'udp';
      const transportOptions = {
        udp: transport === 'udp',
        tcp: transport === 'tcp',
        tls: transport === 'tls'
      };
      
      logger.info(`🔌 Starting SIP stack with ${transport.toUpperCase()} transport`);
      
      // Always create a fresh callback handler to ensure it's properly bound
      // Use arrow function to preserve 'this' context
      this._incomingRequestHandler = (rq) => {
        try {
          logger.debug(`📥 SIP callback invoked - method: ${rq?.method || 'unknown'}, state: ${this.state}, stack: ${!!this.sipStack}`);
          this._handleIncomingRequest(rq);
        } catch (error) {
          logger.error(`❌ Error in incoming request handler: ${error.message}`);
          logger.error(error.stack);
          // Ensure we still respond even on error
          if (rq) {
            try {
              sip.send(sip.makeResponse(rq, 500, 'Server Internal Error'));
            } catch (sendError) {
              logger.error(`❌ Failed to send error response: ${sendError.message}`);
            }
          }
        }
      };
      
      // Start SIP stack with transport configuration
      // Important: sip.start() must be called with the callback - it registers the handler
      logger.info('📝 Registering SIP callback handler...');
      sip.start({
        ...transportOptions,
        logger: {
          send: (message, address) => {
            logger.debug(`📤 SIP SEND to ${address}: ${message.method || 'RESPONSE'}`);
          },
          recv: (message, address) => {
            logger.debug(`📥 SIP RECV from ${address}: ${message.method || 'RESPONSE'}`);
            // Log that we received something - this confirms the callback is working
            if (message.method) {
              logger.debug(`   → Routing to handler: ${message.method}`);
            }
          }
        }
      }, this._incomingRequestHandler);
      
      logger.info('✅ SIP callback handler registered');

      this.sipStack = true;
      this.connectionTimeout = connectionTimeout;
      this._setState('registering');
      
      // Start registration
      await this._register();
      
      logger.info('✅ SIP stack started successfully - attempting registration...');
      logger.info('✅ SIP stack callback registered and ready to receive calls');
      logger.info(`   Callback handler: ${!!this._incomingRequestHandler}, Stack: ${!!this.sipStack}`);
    } catch (error) {
      clearTimeout(connectionTimeout);
      logger.error(`❌ Failed to start SIP stack: ${error.message}`);
      logger.error(error.stack);
      logger.error('   Possible causes:');
      logger.error('   1. Invalid server address format');
      logger.error('   2. Network connectivity issues');
      logger.error('   3. Port already in use');
      this._setState('error', { cause: error.message });
    }
  }

  async _register() {
    if (!this.config.username || !this.config.password || !this.config.server) {
      logger.error('❌ Cannot register: missing username, password, or server');
      this._setState('error', { cause: 'Missing credentials' });
      return;
    }

    // Verify SIP stack is still active
    if (!this.sipStack) {
      logger.error('❌ Cannot register: SIP stack is not active');
      logger.info('   Attempting to restart SIP stack...');
      await this.start();
      return;
    }

    const username = this.config.username;
    // Use domain if provided, otherwise use server hostname as realm
    const domain = this.config.domain || this.serverHost;
    const realm = domain;
    const transport = this.config.transport || 'udp';
    const port = this.config.port || (transport === 'tls' ? 5061 : 5060);
    
    logger.info(`📝 Registering SIP account: ${username}@${domain}`);
    logger.info(`   Server: ${this.serverHost}:${port}, Transport: ${transport.toUpperCase()}, Realm: ${realm}`);
    logger.info(`   SIP stack active: ${!!this.sipStack}, State: ${this.state}`);

    // Create registration session for digest auth
    if (!this.registrationSession) {
      this.registrationSession = { realm: realm || '*' };
    }

    // Build SIP URI - use sips: for TLS, sip: for UDP/TCP
    const scheme = transport === 'tls' ? 'sips' : 'sip';
    const sipUri = this.config.uri || `${scheme}:${username}@${domain}`;
    
    // Build contact URI using domain
    const contactUri = `${scheme}:${username}@${domain}`;
    
    // Registration URI uses server hostname with appropriate scheme
    const registerRequest = {
      method: 'REGISTER',
      uri: `${scheme}:${this.serverHost}:${port}`,
      headers: {
        to: { uri: sipUri },
        from: { uri: sipUri, params: { tag: this._generateTag() } },
        'call-id': this._generateCallId(),
        cseq: { method: 'REGISTER', seq: 1 },
        contact: [{ uri: contactUri }],
        'user-agent': 'SIP Toast/0.1.0',
        expires: 3600,
        via: []
      }
    };

    // Send REGISTER request
    logger.info(`📤 Sending REGISTER to ${scheme}:${this.serverHost}:${port} (${transport.toUpperCase()})`);
    logger.info(`   To: ${sipUri}, From: ${sipUri}, Contact: ${contactUri}`);
    
    sip.send(registerRequest, (rs) => {
      if (!rs) {
        logger.error('❌ Registration response is null or undefined');
        this._setState('error', { cause: 'No response from server' });
        this._scheduleReconnect();
        return;
      }
      
      logger.info(`📥 Received registration response: ${rs.status} ${rs.reason || ''}`);
      logger.info(`   SIP stack still active: ${!!this.sipStack}, State: ${this.state}`);
      
      if (rs.status === 401 || rs.status === 407) {
        // Authentication required - process challenge
        logger.info('🔐 Authentication challenge received, retrying with credentials...');
        
        try {
          // Initialize session if needed
          if (!this.registrationSession) {
            this.registrationSession = { realm: realm };
          }
          
          // Sign the request with authentication (signRequest handles initClientContext internally)
          digest.signRequest(this.registrationSession, registerRequest, rs, {
            user: username,
            password: this.config.password,
            realm: realm
          });
          
          // Update CSeq and resend with authentication
          registerRequest.headers.cseq.seq++;
          logger.info('📤 Resending REGISTER with authentication...');
          sip.send(registerRequest, (rs2) => {
            logger.info(`📥 Authenticated response: ${rs2.status} ${rs2.reason || ''}`);
            this._handleRegistrationResponse(rs2);
          });
        } catch (authError) {
          logger.error(`❌ Authentication error: ${authError.message}`);
          this._setState('error', { cause: `Authentication failed: ${authError.message}` });
        }
      } else {
        this._handleRegistrationResponse(rs);
      }
    });
  }

  _handleRegistrationResponse(rs) {
    if (!rs) {
      logger.error('❌ Registration response is null');
      this._setState('error', { cause: 'Invalid registration response' });
      this._scheduleReconnect();
      return;
    }
    
    if (rs.status >= 200 && rs.status < 300) {
      logger.info('✅ SIP successfully registered and connected');
      
      // Verify SIP stack is still active
      if (!this.sipStack) {
        logger.error('❌ SIP stack is null after successful registration! This should not happen.');
        this._setState('error', { cause: 'SIP stack lost after registration' });
        this._scheduleReconnect();
        return;
      }
      
      this._setState('registered');
      
      // Schedule re-registration before expiration
      const expires = rs.headers.expires ? parseInt(rs.headers.expires) : 3600;
      const reRegisterInterval = Math.max(expires * 0.5 * 1000, 30000); // Re-register at 50% of expiration time
      
      if (this.registrationTimer) {
        clearTimeout(this.registrationTimer);
        this.registrationTimer = null;
      }
      
      this.registrationTimer = setTimeout(async () => {
        logger.info(`🔄 Re-registration timer fired (expires was: ${expires}s, re-registering at ${reRegisterInterval/1000}s)`);
        logger.info(`   Current state: ${this.state}, SIP stack active: ${!!this.sipStack}`);
        
        // Verify SIP stack is still active before re-registering
        if (!this.sipStack) {
          logger.error('❌ SIP stack is not active during re-registration! Restarting...');
          await this.start();
          return;
        }
        
        // Re-register to keep the connection alive
        await this._register();
      }, reRegisterInterval);
      
      logger.info(`⏰ Scheduled re-registration in ${(reRegisterInterval / 1000).toFixed(0)}s (expires: ${expires}s)`);
      logger.info(`   Callback handler active: ${!!this._incomingRequestHandler}`);
      
      // Clear connection timeout
      if (this.connectionTimeout) {
        clearTimeout(this.connectionTimeout);
        this.connectionTimeout = null;
      }
    } else if (rs.status === 401 || rs.status === 403) {
      logger.error('❌ SIP registration failed: Authentication failed');
      logger.error('   🔐 Possible issues:');
      logger.error('      • Username is incorrect');
      logger.error('      • Password is incorrect');
      logger.error('      • Account may be disabled or locked');
      this._setState('error', { cause: 'Authentication failed', statusCode: rs.status });
      this._scheduleReconnect();
    } else if (rs.status === 404) {
      logger.error('❌ SIP registration failed: User not found');
      logger.error('   🔍 Possible issues:');
      logger.error('      • Username/extension does not exist on server');
      logger.error('      • SIP URI format is incorrect');
      this._setState('error', { cause: 'User not found', statusCode: rs.status });
      this._scheduleReconnect();
    } else if (rs.status === 408 || rs.status >= 500) {
      logger.error(`❌ SIP registration failed: Server error (${rs.status})`);
      logger.error('   ⏱️ Possible issues:');
      logger.error('      • Server is not responding');
      logger.error('      • Network connectivity problems');
      logger.error('      • Firewall blocking connection');
      this._setState('error', { cause: `Server error: ${rs.status}`, statusCode: rs.status });
      this._scheduleReconnect();
    } else {
      logger.error(`❌ SIP registration failed: ${rs.status} ${rs.reason || ''}`);
      this._setState('error', { cause: `Registration failed: ${rs.status}`, statusCode: rs.status });
      this._scheduleReconnect();
    }
  }

  _handleIncomingRequest(rq) {
    // Log that we received a request - this helps debug if callback is working
    logger.info(`📥 _handleIncomingRequest called - method: ${rq?.method || 'unknown'}, state: ${this.state}, stack active: ${!!this.sipStack}`);
    
    try {
      // Verify SIP stack is still active
      if (!this.sipStack) {
        logger.error(`❌ SIP stack is null! Cannot handle request. State: ${this.state}`);
        if (rq) {
          try {
            sip.send(sip.makeResponse(rq, 503, 'Service Unavailable'));
          } catch (error) {
            logger.error(`❌ Failed to send 503: ${error.message}`);
          }
        }
        return;
      }
      
      if (this.state !== 'registered') {
        logger.warn(`⚠️ Received SIP request but not registered (state: ${this.state})`);
        if (rq) {
          try {
            sip.send(sip.makeResponse(rq, 503, 'Service Unavailable'));
          } catch (error) {
            logger.error(`❌ Failed to send 503: ${error.message}`);
          }
        }
        return;
      }

      if (!rq || !rq.method) {
        logger.warn('⚠️ Received invalid SIP request (missing method)');
        return;
      }

      logger.info(`📥 Handling SIP request: ${rq.method} (stack active: ${!!this.sipStack}, state: ${this.state})`);

      if (rq.method === 'INVITE') {
        // Incoming call
        const from = rq.headers.from;
        if (!from || !from.uri) {
          logger.warn('⚠️ Received INVITE with invalid From header');
          sip.send(sip.makeResponse(rq, 400, 'Bad Request'));
          return;
        }

        const number = sip.parseUri(from.uri).user;
        const displayName = from.name || number;
        const normalizedNumber = (number || '').replace(/[^\d]/g, '');
        
        logger.info(`📞 Incoming SIP call from ${displayName} (${number})`);
        logger.info(`   SIP stack state: ${this.state}, Active: ${!!this.sipStack}`);

        // Send 100 Trying
        try {
          sip.send(sip.makeResponse(rq, 100, 'Trying'));
        } catch (error) {
          logger.error(`❌ Failed to send 100 Trying: ${error.message}`);
        }

        // Send 180 Ringing
        try {
          sip.send(sip.makeResponse(rq, 180, 'Ringing'));
        } catch (error) {
          logger.error(`❌ Failed to send 180 Ringing: ${error.message}`);
        }

        // Emit incoming call event - ensure listeners are still attached
        const listenerCount = this.listenerCount('incomingCall');
        logger.info(`📢 Emitting incomingCall event (listeners: ${listenerCount})`);
        
        if (listenerCount === 0) {
          logger.error(`❌ CRITICAL: No listeners attached to 'incomingCall' event!`);
          logger.error(`   This means the event handler was lost. Attempting to re-register...`);
          // Try to notify main.js to re-register - but this is a fallback
        }
        
        try {
          this.emit('incomingCall', {
            displayName,
            number,
            normalizedNumber,
            timestamp: new Date().toISOString()
          });
          logger.info(`✅ Successfully emitted incomingCall event`);
        } catch (error) {
          logger.error(`❌ Failed to emit incomingCall event: ${error.message}`);
          logger.error(error.stack);
        }

        // Auto-reject after a short delay (we just want caller ID, not to answer)
        setTimeout(() => {
          try {
            if (this.sipStack && this.state === 'registered') {
              sip.send(sip.makeResponse(rq, 486, 'Busy Here'));
              logger.debug('📤 Sent 486 Busy Here response');
            }
          } catch (error) {
            logger.error(`❌ Failed to send 486 Busy Here: ${error.message}`);
          }
        }, 1000);
      } else if (rq.method === 'REGISTER') {
        // Respond to any REGISTER requests (we're a client, not a server)
        sip.send(sip.makeResponse(rq, 405, 'Method Not Allowed'));
      } else if (rq.method === 'OPTIONS') {
        // Respond to OPTIONS (keep-alive)
        sip.send(sip.makeResponse(rq, 200, 'OK'));
        logger.debug('📤 Responded to OPTIONS keep-alive');
      } else {
        // Default response for other methods
        logger.debug(`📤 Responding 501 to ${rq.method}`);
        sip.send(sip.makeResponse(rq, 501, 'Not Implemented'));
      }
    } catch (error) {
      logger.error(`❌ Error handling incoming SIP request: ${error.message}`);
      logger.error(error.stack);
      if (rq) {
        try {
          sip.send(sip.makeResponse(rq, 500, 'Server Internal Error'));
        } catch (sendError) {
          logger.error(`❌ Failed to send error response: ${sendError.message}`);
        }
      }
    }
  }

  stop() {
    logger.info(`🛑 Stopping SIP manager (state: ${this.state}, stack: ${!!this.sipStack})`);
    
    if (this.registrationTimer) {
      clearTimeout(this.registrationTimer);
      this.registrationTimer = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    if (this.sipStack) {
      logger.info('🛑 Stopping SIP stack');
      try {
        sip.stop();
      } catch (error) {
        logger.error(`❌ Error stopping SIP stack: ${error.message}`);
      }
      this.sipStack = null;
      // Keep the handler reference but it won't be used until start() is called again
      this._setState('idle', { reason: 'stopped' });
    }
  }

  getState() {
    return this.state;
  }

  _hasCredentials() {
    return Boolean(this.config?.server && this.config?.username && this.config?.password);
  }

  _setState(state, meta) {
    this.state = state;
    this.emit('status', {
      state,
      meta,
      timestamp: new Date().toISOString()
    });
  }

  _generateTag() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  _generateCallId() {
    return Math.random().toString(36).substring(2, 15) + '@' + os.hostname();
  }

  _scheduleReconnect() {
    if (this.reconnectTimeout) {
      logger.debug('⏸️ Reconnect already scheduled, skipping');
      return;
    }
    logger.info('⏰ Scheduling SIP reconnection in 5 seconds...');
    this.reconnectTimeout = setTimeout(async () => {
      logger.info('🔄 Attempting SIP reconnection...');
      this.reconnectTimeout = null; // Clear before starting
      
      // Add retry logic with exponential backoff
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          await this.start();
          logger.info('✅ SIP reconnection successful');
          return;
        } catch (error) {
          retryCount++;
          if (retryCount < maxRetries) {
            const delay = Math.min(5000 * Math.pow(2, retryCount - 1), 30000); // Exponential backoff, max 30s
            logger.warn(`⚠️ Reconnection attempt ${retryCount} failed, retrying in ${delay/1000}s...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            logger.error(`❌ SIP reconnection failed after ${maxRetries} attempts`);
            this._setState('error', { cause: 'Reconnection failed after multiple attempts' });
          }
        }
      }
    }, 5000);
  }
  
  // Health check method to verify SIP stack is still active
  checkHealth() {
    const health = {
      state: this.state,
      sipStackActive: !!this.sipStack,
      hasCredentials: this._hasCredentials(),
      callbackHandlerExists: !!this._incomingRequestHandler,
      registrationTimerActive: !!this.registrationTimer,
      reconnectScheduled: !!this.reconnectTimeout
    };
    
    if (this.state === 'registered' && !this.sipStack) {
      logger.error('❌ HEALTH CHECK FAILED: State is registered but SIP stack is null!');
      return { ...health, healthy: false, issue: 'SIP stack lost' };
    }
    
    if (this.state === 'registered' && !this._incomingRequestHandler) {
      logger.error('❌ HEALTH CHECK FAILED: State is registered but callback handler is missing!');
      return { ...health, healthy: false, issue: 'Callback handler lost' };
    }
    
    return { ...health, healthy: this.state === 'registered' && !!this.sipStack && !!this._incomingRequestHandler };
  }
}

module.exports = SipManager;
