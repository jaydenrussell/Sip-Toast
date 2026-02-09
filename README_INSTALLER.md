# MSI Installer - Running Process Detection

The MSI installer for SIP Toast includes functionality to detect if a previous version is running and prompt the user to close it before updating.

## How It Works

When you run the MSI installer to update SIP Toast:

1. **Automatic Detection**: The installer checks if "SIP Toast.exe" is currently running
2. **User Prompt**: If the application is running, you'll see a message asking you to close it
3. **Options**:
   - **OK**: The installer will attempt to close SIP Toast automatically
   - **Cancel**: Installation is cancelled - you can close SIP Toast manually and run the installer again

## Manual Close (If Needed)

If the automatic close doesn't work:

1. Close SIP Toast manually from the system tray (right-click the icon and select "Quit")
2. Or use Task Manager to end the "SIP Toast" process
3. Then run the installer again

## Windows Restart Manager

The installer also uses Windows' built-in Restart Manager, which will automatically detect files in use and prompt you to close applications that are using them. This provides an additional layer of protection during installation.

## Troubleshooting

If you encounter issues during installation:

1. **"Files in use" error**: Close SIP Toast completely and try again
2. **Installation fails**: Make sure no SIP Toast processes are running (check Task Manager)
3. **Can't close automatically**: Manually close the application and retry the installation

## Note

The running process detection is implemented using custom WiX fragments. If you're building from source, ensure the `build/check-running-process.wxs` file is present and the build script includes it properly.

