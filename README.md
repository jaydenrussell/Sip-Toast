## SIP Toast

Minimal Electron companion that sits in the Windows 11 system tray, listens to SIP providers for incoming calls, performs an Acuity Scheduling lookup, and displays a modern toast notification with caller and appointment context. Clicking or waiting dismisses the toast; no call control UI is provided.

### Features
- Background SIP registration using `JsSIP` with automatic reconnection.
- Client lookups against Acuity Scheduling (using basic auth).
- Windows 11-inspired translucent toast window with light/dark support.
- Fluent tray flyout that exposes SIP + Acuity configuration and a live log console.
- System tray presence only; starts with Windows and stays minimized.
- Configurable auto-dismiss timing and secure credential storage via `electron-store`.

### Getting Started
1. Install Node.js 20+.
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

