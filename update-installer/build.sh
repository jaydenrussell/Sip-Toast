#!/bin/bash

echo "Building update installer..."

# Create dist directory
mkdir -p dist

# Copy HTML, CSS, and JS files
cp index.html dist/
cp test.html dist/
cp preload.js dist/

# Create a simple package.json for the installer
cat > dist/package.json << EOF
{
  "name": "sip-toast-update-installer",
  "version": "1.0.0",
  "description": "Update installer for SIP Caller ID application",
  "main": "index.html",
  "author": "SIP Caller ID Team",
  "scripts": {
    "start": "echo 'Update installer is ready. Open index.html in a browser.'"
  }
}
EOF

echo "Build completed successfully!"
echo "Installer available at: $(pwd)/dist"