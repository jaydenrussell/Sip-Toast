# Build Instructions

## Issue
The terminal output capture appears to be broken, so you'll need to run the build manually in your own terminal to see the output.

## Quick Build
```bash
cd "c:\Users\Jayden Russell\Downloads\YourSolution\sip-toast"
npm run package
```

## What Should Happen
1. The `prepackage` script runs automatically (increments version)
2. electron-builder builds the app
3. New installers are created in the `dist` folder

## Manual Steps if Auto-Increment Fails
If the version doesn't auto-increment, run manually:
```bash
node scripts/increment-version.js
npm run package
```

## Verify Build
After build completes, check:
- `dist/SIP Toast [version].msi`
- `dist/SIP Toast [version].appx`

Current version in package.json: Check `package.json` line 3

## Troubleshooting
If build fails, check:
1. Is electron-builder installed? `npm list electron-builder`
2. Are there any errors in the terminal output?
3. Check `dist` folder for any partial builds
