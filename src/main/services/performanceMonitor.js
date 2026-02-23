const { app, process } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      memory: [],
      cpu: [],
      network: [],
      events: []
    };
    this.isMonitoring = false;
    this.monitorInterval = null;
    this.maxMetrics = 1000; // Keep last 1000 data points
    this.monitoringInterval = 5000; // Collect every 5 seconds
    this.logFile = null;
  }

  startMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.logFile = this.getPerformanceLogFile();
    this.writeLog('Performance monitoring started');
    
    // Initial metrics collection
    this.collectMetrics();
    
    // Set up interval for regular collection
    this.monitorInterval = setInterval(() => {
      this.collectMetrics();
    }, this.monitoringInterval);
  }

  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.writeLog('Performance monitoring stopped');
  }

  getPerformanceLogFile() {
    const logDir = path.join(app.getPath('userData'), 'logs');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(logDir, `performance-${timestamp}.log`);
  }

  collectMetrics() {
    try {
      const timestamp = Date.now();
      const memUsage = process.getProcessMemoryInfo ? 
        process.getProcessMemoryInfo() : 
        process.memoryUsage();
      
      const cpuUsage = process.getCPUUsage ? process.getCPUUsage() : null;
      const systemCpu = this.getSystemCpuUsage();
      const systemMem = this.getSystemMemoryUsage();

      const metrics = {
        timestamp,
        process: {
          memory: {
            rss: memUsage.rss,
            heapTotal: memUsage.heapTotal,
            heapUsed: memUsage.heapUsed,
            external: memUsage.external || 0
          },
          cpu: cpuUsage ? {
            user: cpuUsage.user,
            system: cpuUsage.system
          } : null
        },
        system: {
          cpu: systemCpu,
          memory: systemMem,
          uptime: os.uptime()
        },
        app: {
          uptime: process.uptime(),
          platform: process.platform,
          version: process.versions.electron
        }
      };

      this.metrics.memory.push({
        timestamp,
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal
      });

      this.metrics.cpu.push({
        timestamp,
        process: cpuUsage,
        system: systemCpu
      });

      // Keep only recent metrics to prevent memory growth
      this.trimMetrics();

      // Log significant changes
      this.analyzeMetrics(metrics);
      
      // Write to log file
      this.writeLog(JSON.stringify(metrics));

    } catch (error) {
      this.writeLog(`Error collecting metrics: ${error.message}`);
    }
  }

  getSystemCpuUsage() {
    try {
      const cpus = os.cpus();
      let totalIdle = 0;
      let totalTick = 0;

      cpus.forEach(cpu => {
        for (let type in cpu.times) {
          totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
      });

      return {
        idle: totalIdle / cpus.length,
        total: totalTick / cpus.length
      };
    } catch (error) {
      return null;
    }
  }

  getSystemMemoryUsage() {
    try {
      return {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem()
      };
    } catch (error) {
      return null;
    }
  }

  trimMetrics() {
    // Keep only the most recent metrics to prevent memory growth
    if (this.metrics.memory.length > this.maxMetrics) {
      this.metrics.memory = this.metrics.memory.slice(-this.maxMetrics);
    }
    if (this.metrics.cpu.length > this.maxMetrics) {
      this.metrics.cpu = this.metrics.cpu.slice(-this.maxMetrics);
    }
  }

  analyzeMetrics(currentMetrics) {
    const mem = currentMetrics.process.memory;
    const systemMem = currentMetrics.system.memory;
    const heapUsagePercent = (mem.heapUsed / mem.heapTotal) * 100;
    const rssUsagePercent = (mem.rss / systemMem.total) * 100;

    // Memory leak detection
    if (heapUsagePercent > 80) {
      this.writeLog(`WARNING: High heap usage detected: ${heapUsagePercent.toFixed(1)}%`);
    }

    if (rssUsagePercent > 50) {
      this.writeLog(`WARNING: High RSS memory usage detected: ${rssUsagePercent.toFixed(1)}%`);
    }

    // Memory growth detection (compare with previous metrics)
    if (this.metrics.memory.length > 10) {
      const recent = this.metrics.memory.slice(-10);
      const oldest = recent[0];
      const newest = recent[recent.length - 1];
      const heapGrowth = newest.heapUsed - oldest.heapUsed;
      const rssGrowth = newest.rss - oldest.rss;

      if (heapGrowth > 50 * 1024 * 1024) { // 50MB growth
        this.writeLog(`WARNING: Potential memory leak detected - heap grew by ${(heapGrowth / 1024 / 1024).toFixed(2)}MB`);
      }

      if (rssGrowth > 100 * 1024 * 1024) { // 100MB growth
        this.writeLog(`WARNING: Potential memory leak detected - RSS grew by ${(rssGrowth / 1024 / 1024).toFixed(2)}MB`);
      }
    }
  }

  writeLog(message) {
    try {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}\n`;
      
      if (!this.logFile) {
        this.logFile = this.getPerformanceLogFile();
      }
      
      fs.appendFileSync(this.logFile, logEntry);
    } catch (error) {
      // Silent fail for logging errors to prevent recursion
    }
  }

  getMetrics() {
    return {
      memory: this.metrics.memory.slice(-100), // Last 100 entries
      cpu: this.metrics.cpu.slice(-100),
      summary: this.getSummary()
    };
  }

  getSummary() {
    if (this.metrics.memory.length === 0) return {};

    const mem = this.metrics.memory;
    const cpu = this.metrics.cpu;
    
    const latestMem = mem[mem.length - 1];
    const latestCpu = cpu[cpu.length - 1];

    return {
      current: {
        memory: {
          rss: latestMem.rss,
          heapUsed: latestMem.heapUsed,
          heapTotal: latestMem.heapTotal
        },
        cpu: latestCpu ? latestCpu.process : null
      },
      averages: {
        memory: {
          avgRss: mem.reduce((sum, m) => sum + m.rss, 0) / mem.length,
          avgHeapUsed: mem.reduce((sum, m) => sum + m.heapUsed, 0) / mem.length
        }
      },
      trends: this.calculateTrends()
    };
  }

  calculateTrends() {
    if (this.metrics.memory.length < 10) return {};

    const mem = this.metrics.memory;
    const recent = mem.slice(-10);
    const oldest = recent[0];
    const newest = recent[recent.length - 1];

    return {
      memory: {
        heapGrowth: newest.heapUsed - oldest.heapUsed,
        rssGrowth: newest.rss - oldest.rss,
        heapGrowthRate: (newest.heapUsed - oldest.heapUsed) / (newest.timestamp - oldest.timestamp)
      }
    };
  }

  // Event tracking for performance analysis
  trackEvent(eventType, data = {}) {
    const event = {
      type: eventType,
      timestamp: Date.now(),
      data
    };
    
    this.metrics.events.push(event);
    this.writeLog(`Event: ${eventType} - ${JSON.stringify(data)}`);
  }

  // Cleanup old log files
  cleanupOldLogs() {
    try {
      const logDir = path.join(app.getPath('userData'), 'logs');
      if (!fs.existsSync(logDir)) return;

      const files = fs.readdirSync(logDir);
      const performanceFiles = files.filter(f => f.startsWith('performance-') && f.endsWith('.log'));
      
      // Keep only the last 5 performance log files
      if (performanceFiles.length > 5) {
        const sorted = performanceFiles.sort((a, b) => {
          const timeA = fs.statSync(path.join(logDir, a)).mtime;
          const timeB = fs.statSync(path.join(logDir, b)).mtime;
          return timeA - timeB;
        });
        
        const toDelete = sorted.slice(0, sorted.length - 5);
        toDelete.forEach(file => {
          try {
            fs.unlinkSync(path.join(logDir, file));
          } catch (error) {
            // Silent fail
          }
        });
      }
    } catch (error) {
      // Silent fail
    }
  }
}

// Singleton instance
const performanceMonitor = new PerformanceMonitor();

module.exports = performanceMonitor;