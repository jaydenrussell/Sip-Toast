## SIP Toast

Minimal Electron companion that sits in the Windows 11 system tray, listens to SIP providers for incoming calls, performs an Acuity Scheduling lookup, and displays a modern toast notification with caller and appointment context. Clicking or waiting dismisses the toast; no call control UI is provided.

### Features
- Background SIP registration using `JsSIP` with automatic reconnection.
- Client lookups against Acuity Scheduling (using basic auth).
- Windows 11-inspired translucent toast window with light/dark support.
- Fluent tray flyout that exposes SIP + Acuity configuration and a live log console.
- System tray presence only; starts with Windows and stays minimized.
- Configurable auto-dismiss timing and secure credential storage via `electron-store`.

### 🪟 Windows 11 Installation

#### System Requirements
- **Windows 10 version 1809 or later** (Windows 11 recommended)
- **64-bit (x64) processor** - Required
- **Microsoft Visual C++ Redistributable 2015-2022** (usually pre-installed)
- **Internet connectivity** - Required for SIP and API calls

#### Quick Installation
1. **Download the latest installer** from [Releases](https://github.com/jaydenrussell/Sip-Toast/releases)
2. **Run the MSI installer** (`SIP Toast X.X.X.msi`)
3. **Launch the application** from Start Menu or Desktop shortcut
4. **Configure settings** using the system tray icon

#### Verify Installation
Run the dependency checker to ensure your system is ready:
```powershell
# Download and run the dependency checker
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/jaydenrussell/Sip-Toast/main/check-dependencies.ps1" -OutFile "check-dependencies.ps1"
.\check-dependencies.ps1
```

#### Manual Installation (Development)
1. Install Node.js 20+ from [nodejs.org](https://nodejs.org/)
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure credentials by launching once (which creates settings) or editing `%APPDATA%/sip-toast/config.json`. Required fields:
   ```json
   {
     "sip": {
       "websocket": "wss://your-sbc.example.com:7443/ws",
       "uri": "sip:1001@your-sbc.example.com",
       "username": "1001",
       "password": "superSecret",
       "displayName": "Front Desk"
     },
     "acuity": {
       "userId": "ACUITY_USER_ID",
       "apiKey": "ACUITY_API_KEY"
     }
   }
   ```
4. Run in development:
   ```bash
   npm run dev
   ```
5. Build an installer:
   ```bash
   npm run package
   ```

### Behavior Notes
- Notifications contain only caller info and lookup results; clicking the toast hides it.
- Left-click the tray icon to open the Control Center flyout where you can edit SIP/Acuity settings, restart registration, or watch the live log stream.
- Auto-start is configurable inside the Control Center (Launch with Windows toggle).
- Toast appearance adapts to system theme and auto-dismisses after the configured duration (`toast.autoDismissMs`).
- Logs are stored at `%USERPROFILE%/AppData/Roaming/sip-toast.log`.
- Use the “Simulate Toast” button in the Control Center to trigger a demo incoming-call notification without needing a live SIP call.

### Security
- Store SIP passwords and Acuity keys in Windows Credential Manager or update `settings.js` to read from environment variables before production use.
- The current implementation uses `electron-store`; consider integrating `keytar` for encrypted storage in future iterations.

### 🔧 Troubleshooting

#### Application Won't Start
1. **Check Windows version**: Must be Windows 10+ (Settings > System > About)
2. **Install Visual C++ Redistributable**: Download from [Microsoft](https://aka.ms/vs/17/release/vc_redist.x64.exe)
3. **Check logs**: `%APPDATA%\sip-toast\logs\sip-toast.log`

#### SIP Connection Issues
1. **Verify network connectivity**: Can you ping your SIP server?
2. **Check firewall**: Ensure outbound connections are allowed on SIP ports (5060/5061)
3. **Verify credentials**: Test with your SIP provider's web interface
4. **Check logs**: Look for specific error messages in the log file

#### Acuity API Issues
1. **Verify API credentials**: Test in Acuity Scheduling web interface
2. **Check internet connectivity**: Required for API calls
3. **Review logs**: Look for authentication errors

#### Toast Notifications Not Appearing
1. **Check Windows notification settings**: Settings > System > Notifications
2. **Verify SIP connection**: Must be registered to receive calls
3. **Check auto-dismiss timeout**: May be set too low in settings

#### Works on One Computer but Not Another
1. **Run dependency checker**: `.\check-dependencies.ps1`
2. **Compare Windows versions**: Both must be Windows 10+
3. **Check Visual C++ Redistributable**: Install if missing
4. **Verify network/firewall settings**: May differ between computers

### 📦 Dependencies

All runtime dependencies are **automatically bundled** with the MSI installer:

**Bundled (No installation needed):**
- Electron 31.3.0 runtime
- All npm packages (axios, electron-store, sip, winston, etc.)
- Application code and resources

**System Requirements (Must be present):**
- Windows 10+ (Windows 11 recommended)
- 64-bit (x64) processor
- Visual C++ Redistributable 2015-2022 (usually pre-installed)
- Internet connectivity

For detailed dependency information, see [DEPENDENCIES.md](DEPENDENCIES.md).

