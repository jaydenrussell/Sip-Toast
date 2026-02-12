/*
 * SIP Toast Update Launcher
 * A minimal executable that runs update.bat and then launches the main app
 * Compile with: cl /O2 /W0 update-launcher.c /Fe:update.exe
 * Or use MinGW: gcc -O2 -o update.exe update-launcher.c
 */

#include <windows.h>
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char *argv[]) {
    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    DWORD exitCode = 0;
    char appPath[MAX_PATH];
    char batchPath[MAX_PATH];
    char cmdLine[MAX_PATH * 2];
    
    // Get the directory where this executable is located
    GetModuleFileNameA(NULL, appPath, MAX_PATH);
    
    // Remove the executable name to get directory
    char *lastSlash = strrchr(appPath, '\\');
    if (lastSlash) {
        *lastSlash = '\0';
    }
    
    // Build path to update.bat in the same directory
    snprintf(batchPath, MAX_PATH, "%s\\update.bat", appPath);
    
    // Build command line to run the batch file
    // cmd /c "path\to\update.bat"
    snprintf(cmdLine, MAX_PATH * 2, "cmd /c \"%s\"", batchPath);
    
    // Initialize STARTUPINFO
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));
    
    // Try to run update.bat (optional - if it doesn't exist, just launch the app)
    if (CreateProcessA(
        NULL,
        cmdLine,
        NULL,
        NULL,
        FALSE,
        CREATE_NO_WINDOW,
        NULL,
        appPath,
        &si,
        &pi
    )) {
        // Wait for update.bat to complete
        WaitForSingleObject(pi.hProcess, INFINITE);
        GetExitCodeProcess(pi.hProcess, &exitCode);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    }
    
    // Now launch the main application
    snprintf(cmdLine, MAX_PATH * 2, "\"%s\\SIP Toast.exe\"", appPath);
    
    // Reinitialize STARTUPINFO for the main app
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));
    
    // Launch the main application (shown normally)
    if (CreateProcessA(
        NULL,
        cmdLine,
        NULL,
        NULL,
        FALSE,
        NORMAL_PRIORITY_CLASS | CREATE_NEW_CONSOLE,
        NULL,
        appPath,
        &si,
        &pi
    )) {
        // Don't wait for the main app - let it run independently
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    } else {
        // If main app fails to launch, show error
        char errorMsg[256];
        snprintf(errorMsg, 256, "Failed to launch SIP Toast.exe (Error: %lu)", GetLastError());
        MessageBoxA(NULL, errorMsg, "Update Launcher Error", MB_OK | MB_ICONERROR);
        return 1;
    }
    
    return 0;
}
