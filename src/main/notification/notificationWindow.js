const { BrowserWindow, ipcMain, nativeTheme, screen } = require('electron');
const path = require('path');
const { get, getWindowBounds, setWindowBounds } = require('../settings');

class NotificationWindow {
  constructor() {
    this.window = null;
    this.hideTimeout = null;
    this.isReady = false;
    this.pendingPayload = null;
    this.currentTimeoutMs = null;
    this.currentPhoneNumber = null;
    this._eventHandlers = {}; // Store bound handlers for cleanup
    this._createWindow();
    
    // Store bound handlers for proper cleanup
    this._eventHandlers.toastClicked = (event, phoneNumber, success) => {
      // Log toast click/copy event
      const { logToastClick } = require('../services/eventLogger');
      logToastClick(phoneNumber, success);
      // Don't hide on click - let timeout handle it
    };

    this._eventHandlers.toastClose = () => {
      this.hide();
    };

    ipcMain.on('toast-clicked', this._eventHandlers.toastClicked);
    ipcMain.on('toast:close', this._eventHandlers.toastClose);
  }

  _calculateSize(payload) {
    // Determine if we need full size or compact size
    const hasAcuity = payload.acuityConfigured || payload.clientName || payload.appointmentTime;
    
    // If Acuity is not enabled/available, use compact size
    if (!hasAcuity) {
      return { width: 300, height: 130 };
    }
    
    // Full size for when Acuity is enabled
    return { width: 340, height: 200 };
  }

  // Fallback manual resize for older Electron versions
  _manualResize(edge) {
    const win = this.window;
    if (!win || win.isDestroyed()) return;
    
    const startPoint = screen.getCursorScreenPoint();
    const startX = startPoint.x;
    const startY = startPoint.y;
    const [startWidth, startHeight] = win.getSize();
    const [startLeft, startTop] = win.getPosition();
    
    let lastTime = Date.now();
    
    const onMove = () => {
      const now = Date.now();
      const delta = now - lastTime;
      if (delta < 8) return; // Limit to ~120fps for smoother feel
      lastTime = now;
      
      const currentPoint = screen.getCursorScreenPoint();
      const deltaX = currentPoint.x - startX;
      const deltaY = currentPoint.y - startY;
      
      let newWidth = startWidth;
      let newHeight = startHeight;
      let newLeft = startLeft;
      let newTop = startTop;
      
      if (edge.includes('right')) {
        newWidth = Math.max(250, startWidth + deltaX);
      }
      if (edge.includes('left')) {
        newWidth = Math.max(250, startWidth - deltaX);
        newLeft = startLeft + startWidth - newWidth;
      }
      if (edge.includes('bottom')) {
        newHeight = Math.max(120, startHeight + deltaY);
      }
      if (edge.includes('top')) {
        newHeight = Math.max(120, startHeight - deltaY);
        newTop = startTop + startHeight - newHeight;
      }
      
      win.setBounds({
        x: newLeft,
        y: newTop,
        width: newWidth,
        height: newHeight
      }, false); // false = don't animate, for snappier feel
    };
    
    let resizeInterval = setInterval(() => {
      try {
        if (win.isDestroyed()) {
          clearInterval(resizeInterval);
          return;
        }
        onMove();
      } catch (e) {
        clearInterval(resizeInterval);
      }
    }, 8);
    
    win.webContents.executeJavaScript(`
      const stopResize = () => {
        if (window.__resizeInterval) {
          clearInterval(window.__resizeInterval);
          window.__resizeInterval = null;
        }
        document.removeEventListener('mouseup', stopResize);
      };
      document.addEventListener('mouseup', stopResize, { once: true });
      window.__resizeInterval = ${resizeInterval};
    `);
    
    setTimeout(() => {
      if (resizeInterval) {
        clearInterval(resizeInterval);
        resizeInterval = null;
      }
    }, 30000);
  }

  _createWindow() {
    // Reset ready state when creating a new window
    this.isReady = false;
    this.pendingPayload = null;

    // Default to full size initially, will be resized when payload is received
    // Using frameless window - transparent: false allows native Windows resize to work
    this.window = new BrowserWindow({
      width: 340,
      height: 200,
      minWidth: 300,
      minHeight: 140,
      show: false,
      frame: false,
      resizable: true,
      alwaysOnTop: true,
      focusable: true,
      skipTaskbar: true,
      transparent: false, // Must be false for native resize to work on Windows
      backgroundColor: '#f0f4f8', // Light mode default - will be updated based on theme
      title: '',
      minimizable: false,
      maximizable: false,
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'preload', 'notificationPreload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    
    // Remove the window menu (prevents keyboard shortcuts for min/max)
    this.window.setMenu(null);

    this.window.loadFile(path.join(__dirname, '..', '..', 'renderer', 'notification.html'));
    
    // Mark window as ready when it finishes loading and DOM is ready
    this.window.webContents.once('did-finish-load', () => {
      // Wait a bit more to ensure DOM is fully ready
      setTimeout(() => {
        this.isReady = true;
        // If there's a pending payload, send it now
        if (this.pendingPayload) {
          this._sendNotificationData(this.pendingPayload);
          this.pendingPayload = null;
        }
      }, 200);
    });
    
    // Also listen for DOM ready as a backup
    this.window.webContents.executeJavaScript(`
      new Promise((resolve) => {
        if (document.readyState === 'complete') {
          resolve();
        } else {
          window.addEventListener('load', () => resolve());
        }
      });
    `).then(() => {
      // DOM is ready, mark as ready if not already
      if (!this.isReady) {
        setTimeout(() => {
          this.isReady = true;
          if (this.pendingPayload) {
            this._sendNotificationData(this.pendingPayload);
            this.pendingPayload = null;
          }
        }, 100);
      }
    }).catch(() => {
      // Ignore errors
    });

    // Save bounds and reset ready state if window is destroyed
    this.window.on('closed', () => {
      // Save final bounds before window is destroyed
      if (this.window && !this.window.isDestroyed()) {
        try {
          const [x, y] = this.window.getPosition();
          const [width, height] = this.window.getSize();
          setWindowBounds('toast', { x, y, width, height });
        } catch (error) {
          // Window might already be destroyed, ignore
        }
      }
      this.isReady = false;
      this.pendingPayload = null;
    });
    
    // Save position and size on move (dragging)
    this.window.on('move', () => {
      if (this.window && this.window.isVisible()) {
        const [x, y] = this.window.getPosition();
        const [width, height] = this.window.getSize();
        setWindowBounds('toast', { x, y, width, height });
      }
    });

    // Save size on resize
    this.window.on('resize', () => {
      if (this.window && this.window.isVisible()) {
        const [x, y] = this.window.getPosition();
        const [width, height] = this.window.getSize();
        setWindowBounds('toast', { x, y, width, height });
      }
    });

    // Don't hide toast when window loses focus - only hide on timeout or click
    this.window.on('blur', () => {
      // Do nothing - toast should stay visible until timeout or clicked
    });
  }

  _sendNotificationData(payload) {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    // Check if window is ready - either marked as ready or not loading (fallback)
    if (!this.isReady) {
      // If window has finished loading but we haven't marked it ready yet, mark it now
      if (!this.window.webContents.isLoading()) {
        this.isReady = true;
      } else {
        // Window is still loading, queue the payload
        this.pendingPayload = payload;
        return;
      }
    }

    // Get font settings from settings
    // Use Caller ID font settings for the caller name
    const callerIdFont = get('toast.callerIdFont', 'Segoe UI Variable, Segoe UI, sans-serif');
    const callerIdFontSize = get('toast.callerIdFontSize', 20);
    const callerIdColor = get('toast.callerIdColor', '#FFFFFF');
    const numberFont = get('toast.numberFont', 'Segoe UI Variable, Segoe UI, sans-serif');
    const numberFontSize = get('toast.numberFontSize', 15);
    const numberColor = get('toast.numberColor', '#FFFFFF');

    // Send the notification data
    try {
      this.window.webContents.send('notification:data', {
        ...payload,
        theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
        callerIdFont,
        callerIdFontSize,
        callerIdColor,
        numberFont,
        numberFontSize,
        numberColor
      });
    } catch (error) {
      const { logger } = require('../services/logger');
      logger.error(`❌ Failed to send notification data: ${error.message}`);
      // If send failed, try to recreate window
      if (this.window.isDestroyed()) {
        this._createWindow();
        this.pendingPayload = payload;
      }
    }
  }

  show(payload) {
    // Get timeout from settings - ensure it's a number and has a valid minimum
    let autoDismissMs = get('toast.autoDismissMs', 20000);
    if (typeof autoDismissMs !== 'number' || isNaN(autoDismissMs) || autoDismissMs < 1000) {
      autoDismissMs = 20000; // Default to 20 seconds if invalid
    }
    
    const { logger } = require('../services/logger');
    logger.info(`🔔 Showing toast notification (will auto-dismiss in ${autoDismissMs / 1000}s)`);
    
    if (!this.window || this.window.isDestroyed()) {
      this._createWindow();
    }

    // Get saved bounds (position and size) or calculate defaults
    const saved = getWindowBounds('toast');
    let bounds;
    let size;
    
    if (saved && typeof saved.x === 'number' && !isNaN(saved.x) && typeof saved.y === 'number' && !isNaN(saved.y) && saved.width > 0 && saved.height > 0) {
      // Use saved size and position
      bounds = {
        x: Math.round(saved.x),
        y: Math.round(saved.y),
        width: Math.round(saved.width),
        height: Math.round(saved.height)
      };
      
      // Ensure saved size respects minimum constraints only (no maximum limit)
      bounds.width = Math.max(250, bounds.width);
      bounds.height = Math.max(120, bounds.height);
      
      // Create size object for payload (using saved bounds)
      size = {
        width: bounds.width,
        height: bounds.height
      };
    } else {
      // Calculate default size based on content
      size = this._calculateSize(payload);
      const display = screen.getPrimaryDisplay();
      const { x, y, width, height } = display.workArea;
      
      // Default position (bottom-right corner)
      bounds = {
        x: Math.round(x + width - size.width - 20),
        y: Math.round(y + height - size.height - 20),
        width: size.width,
        height: size.height
      };
      
      // Save default bounds
      setWindowBounds('toast', bounds);
    }

    // Set size first, then position
    this.window.setSize(bounds.width, bounds.height, false);
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setPosition(bounds.x, bounds.y);
    
    // Update background color based on theme
    const isDark = nativeTheme.shouldUseDarkColors;
    const bgColor = isDark ? '#1d212c' : '#f0f4f8';
    this.window.setBackgroundColor(bgColor);
    
    // Store timeout duration and phone number for logging
    this.currentTimeoutMs = autoDismissMs;
    this.currentPhoneNumber = payload.phoneNumber;
    
    // Send notification data (will queue if not ready)
    // Include size info in payload so renderer can adjust layout
    this._sendNotificationData({
      ...payload,
      windowSize: size
    });

    this.window.show();
    this.window.focus();
    this.window.setOpacity(1);

    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }

    this.hideTimeout = setTimeout(() => {
      // Log timeout when toast is hidden
      const { logToastTimeout } = require('../services/eventLogger');
      logToastTimeout(this.currentTimeoutMs, this.currentPhoneNumber);
      this.hide();
    }, autoDismissMs);
  }

  hide() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    if (this.window && this.window.isVisible()) {
      // Save bounds before hiding
      const [x, y] = this.window.getPosition();
      const [width, height] = this.window.getSize();
      setWindowBounds('toast', { x, y, width, height });
      this.window.hide();
    }
  }

  destroy() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    this.isReady = false;
    this.pendingPayload = null;
    this.currentTimeoutMs = null;
    this.currentPhoneNumber = null;
    
    if (this.window) {
      // Remove all listeners to prevent memory leaks
      this.window.removeAllListeners();
      if (!this.window.isDestroyed()) {
        this.window.destroy();
      }
      this.window = null;
    }
    
    // Remove only our specific IPC listeners (not all listeners)
    if (this._eventHandlers.toastClicked) {
      ipcMain.removeListener('toast-clicked', this._eventHandlers.toastClicked);
    }
    if (this._eventHandlers.toastClose) {
      ipcMain.removeListener('toast:close', this._eventHandlers.toastClose);
    }
    this._eventHandlers = {};
  }
}

module.exports = NotificationWindow;

