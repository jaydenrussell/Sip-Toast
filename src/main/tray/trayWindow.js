const { BrowserWindow, nativeTheme } = require('electron');
const path = require('path');
const settings = require('../settings');

class TrayWindow {
  constructor() {
    this.window = null;
    this.visible = false;
    this.mode = 'docked';
    this.createWindow();
  }

  createWindow() {
    const savedBounds = settings.getWindowBounds('tray');
    const defaultWidth = 800;
    const defaultHeight = 600;
    
    this.window = new BrowserWindow({
      width: savedBounds?.width || defaultWidth,
      height: savedBounds?.height || defaultHeight,
      x: savedBounds?.x,
      y: savedBounds?.y,
      show: false,
      frame: false,
      resizable: true,
      minWidth: 800,
      minHeight: 600,
      // Remove maximum size restrictions
      skipTaskbar: false,
      transparent: false,
      backgroundColor: '#f8f9fc',
      webPreferences: {
        preload: path.join(__dirname, '..', '..', 'preload', 'trayPreload.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    this.window.loadFile(path.join(__dirname, '..', '..', 'renderer', 'tray.html'));

    // Handle minimize to tray
    this.window.on('minimize', (event) => {
      event.preventDefault();
      this.window.hide();
    });

    // Handle close to tray
    this.window.on('close', (event) => {
      if (!this.window.isDestroyed()) {
        event.preventDefault();
        this.window.hide();
      }
    });

    // Don't hide on blur - window should stay visible unless explicitly closed or minimized

    this.window.on('move', () => {
      if (this.mode === 'window') {
        const [x, y] = this.window.getPosition();
        const { width, height } = this.window.getBounds();
        settings.setWindowBounds('tray', { x, y, width, height });
        // Send resize event to renderer for responsive layout adjustments
        this.window.webContents.send('window:resized', { width, height });
      }
    });

    this.window.on('resize', () => {
      if (this.mode === 'window') {
        const [x, y] = this.window.getPosition();
        const { width, height } = this.window.getBounds();
        settings.setWindowBounds('tray', { x, y, width, height });
        // Send resize event to renderer for responsive layout adjustments
        this.window.webContents.send('window:resized', { width, height });
      }
    });

    // Update window background based on theme
    const updateWindowTheme = () => {
      const isDark = nativeTheme.shouldUseDarkColors;
      const bgColor = isDark ? '#0f172a' : '#f8f9fc';
      this.window?.setBackgroundColor(bgColor);
      this.window?.webContents.send('theme:changed', {
        theme: isDark ? 'dark' : 'light'
      });
    };

    // Listen for theme changes and notify renderer
    // Memory optimization: Only update theme when window is visible
    this.themeUpdateHandler = () => {
      if (this.window && this.window.isVisible() && !this.window.isDestroyed()) {
        updateWindowTheme();
      }
    };
    nativeTheme.on('updated', this.themeUpdateHandler);

    // Send initial theme and ensure it's applied
    this.window.webContents.once('did-finish-load', () => {
      updateWindowTheme();
    });
    
    // Apply theme immediately if window is already loaded
    if (!this.window.webContents.isLoading()) {
      updateWindowTheme();
    }
  }

  destroy() {
    // Remove theme listener to prevent memory leaks
    if (this.themeUpdateHandler) {
      nativeTheme.removeListener('updated', this.themeUpdateHandler);
      this.themeUpdateHandler = null;
    }
    if (this.window) {
      // Remove all listeners to prevent memory leaks
      this.window.removeAllListeners();
      this.window.destroy();
      this.window = null;
    }
  }

  ensureWindow() {
    if (this.window?.isDestroyed()) {
      this.createWindow();
    }
  }

  // Removed unused toggleDocked and showDocked methods - only showStandalone is used

  showStandalone() {
    this.ensureWindow();
    if (!this.window) return;

    this.mode = 'window';
    this.window.setAlwaysOnTop(false);
    this.window.setResizable(true);
    this.window.setMinimumSize(800, 600);
    // Remove maximum size restrictions
    this.window.setSkipTaskbar(false);
    
    // Memory optimization: Restore normal frame rate when shown
    if (this.window && !this.window.isDestroyed()) {
      try {
        this.window.webContents.setFrameRate(60); // Restore to 60 FPS when visible
      } catch (error) {
        // Ignore errors
      }
    }
    
    const savedBounds = settings.getWindowBounds('tray');
    if (savedBounds) {
      // Validate bounds are within screen dimensions
      const { screen } = require('electron');
      const display = screen.getDisplayMatching(savedBounds);
      
      // Ensure window fits within screen bounds
      const maxWidth = display.bounds.width;
      const maxHeight = display.bounds.height;
      
      let width = Math.min(savedBounds.width || 800, maxWidth);
      let height = Math.min(savedBounds.height || 600, maxHeight);
      let x = savedBounds.x;
      let y = savedBounds.y;
      
      // Adjust position if window would be off-screen
      if (x + width > display.bounds.x + display.bounds.width) {
        x = display.bounds.x + display.bounds.width - width;
      }
      if (y + height > display.bounds.y + display.bounds.height) {
        y = display.bounds.y + display.bounds.height - height;
      }
      if (x < display.bounds.x) {
        x = display.bounds.x;
      }
      if (y < display.bounds.y) {
        y = display.bounds.y;
      }
      
      this.window.setBounds({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
      });
    } else {
      this.window.center();
    }
    this.window.show();
    this.window.focus();
    this.visible = true;
    
    // Send initial resize event to ensure responsive layout is applied
    const { width, height } = this.window.getBounds();
    this.window.webContents.send('window:resized', { width, height });
  }

  hide() {
    if (!this.window || this.mode === 'window') return;
    this.window.hide();
    this.visible = false;
    
    // Memory optimization: Reduce renderer process memory when hidden
    if (this.window && !this.window.isDestroyed()) {
      try {
        // Suspend rendering to save memory
        this.window.webContents.setFrameRate(1); // Reduce to 1 FPS when hidden
        // Clear webContents cache
        this.window.webContents.session.clearCache();
      } catch (error) {
        // Ignore errors
      }
    }
  }

  send(channel, payload) {
    this.ensureWindow();
    if (!this.window) return;
    this.window.webContents.send(channel, payload);
  }

  // Handle window resize events from renderer
  onWindowResized(callback) {
    if (this.window) {
      this.window.webContents.on('did-finish-load', () => {
        this.window.webContents.send('window:resized', this.window.getBounds());
      });
    }
  }
}

module.exports = TrayWindow;

