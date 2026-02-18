# SIP Toast

A modern Windows 11-ready SIP caller ID application that displays toast notifications with caller information and Acuity Scheduling integration.

## Features

- **SIP Integration** - Native SIP stack for reliable call detection with UDP/TCP/TLS transport support
- **Acuity Scheduling** - Automatic client lookup for incoming calls
- **Windows 11 Toast Notifications** - Modern, translucent toast with light/dark theme support
- **System Tray App** - Runs quietly in the background with minimal resource usage
- **Auto-Update** - Discord-style silent background updates via Squirrel.Windows
- **Secure Storage** - Credentials encrypted using Windows DPAPI via Electron's safeStorage
- **Event Logging** - Persistent log of all SIP calls and toast interactions

## Installation

Download the latest installer from [Releases](https://github.com/jaydenrussell/Sip-Toast/releases).

The app will:
1. Install to `%LocalAppData%\SIPToast`
2. Start automatically with Windows
3. Run in the system tray

## Configuration

### SIP Provider Settings

Open the Control Center by clicking the tray icon and navigate to **SIP Provider**:

| Field | Description |
|-------|-------------|
| Server | SIP server hostname or IP (e.g., `sip.example.com`) |
| Port | SIP port (default: 5060 for UDP/TCP, 5061 for TLS) |
| Transport | UDP, TCP, or TLS |
| Domain | SIP domain (optional, defaults to server hostname) |
| Username | SIP extension/username |
| Password | SIP password (encrypted) |

### Acuity Scheduler Settings

Navigate to **Acuity Scheduler** to configure client lookups:

| Field | Description |
|-------|-------------|
| Enabled | Toggle Acuity integration on/off |
| User ID | Your Acuity user ID |
| API Key | Your Acuity API key (encrypted) |

### Options

- **Auto-dismiss timeout** - How long toast notifications display (default: 20 seconds)
- **Launch at startup** - Start automatically with Windows

## Security

### Credential Storage

Sensitive credentials (SIP password, Acuity API key) are encrypted using:

- **Windows**: DPAPI (Data Protection API) via Electron's `safeStorage`
- **Fallback**: AES-256-GCM with machine-specific key derivation

Credentials are:
- Never stored in plain text
- Bound to the current Windows user account
- Cannot be transferred to another machine

### Encryption Details

The app uses Electron's `safeStorage` API which leverages:
- Windows DPAPI for secure credential storage
- User-specific encryption keys managed by the OS
- No additional dependencies required

## Development

### Prerequisites

- Node.js 20+
- npm 10+

### Setup

```bash
# Clone the repository
git clone https://github.com/jaydenrussell/Sip-Toast.git
cd Sip-Toast

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build installer
npm run package:squirrel

# Create a release
npm run release
```

### Project Structure

```
src/
├── main/
│   ├── main.js           # Main Electron process
│   ├── settings.js       # Settings management with encryption
│   ├── sip/              # SIP stack integration
│   ├── notification/     # Toast notification window
│   ├── tray/             # System tray and control center
│   └── services/         # Utilities (logger, encryption, etc.)
├── preload/              # Context bridge scripts
├── renderer/             # UI (HTML, JS, CSS)
└── styles/               # Stylesheets
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Run the app |
| `npm run dev` | Run with hot reload |
| `npm run lint` | Run ESLint |
| `npm run package:squirrel` | Build Squirrel.Windows installer |
| `npm run release` | Build and create GitHub release |

## Auto-Update

The app uses Squirrel.Windows for automatic updates:

1. **Silent Check** - Checks for updates 30 seconds after startup
2. **Background Download** - Updates download silently without user interaction
3. **Apply on Restart** - Update installs when the app naturally restarts
4. **No Forced Restarts** - Users are never interrupted

## Logs

- **Application logs**: `%APPDATA%\sip-toast\logs\sip-toast.log`
- **Event logs**: `%APPDATA%\sip-toast\events.json`

View live logs in the Control Center under **Event Logs**.

## Troubleshooting

### SIP Connection Issues

1. Check firewall settings (Control Center → Firewall)
2. Verify server address and port
3. Ensure username/password are correct
4. Try different transport (UDP/TCP/TLS)

### Toast Not Showing

1. Check Windows notification settings
2. Verify app is running in system tray
3. Check if "Focus Assist" is enabled

### Update Issues

1. Check internet connection
2. Verify GitHub releases are accessible
3. Check `%LocalAppData%\SIPToast\Update.exe` exists

## License

MIT License - See [LICENSE](LICENSE) for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Support

- [GitHub Issues](https://github.com/jaydenrussell/Sip-Toast/issues)
- [Releases](https://github.com/jaydenrussell/Sip-Toast/releases)