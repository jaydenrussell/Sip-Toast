/*
 * SIP Toast Update Launcher
 * A minimal executable that runs update.bat and then launches the main app
 * Compile with PowerShell: 
 *   Add-Type -Path 'build/UpdateLauncher.cs' -OutputAssembly 'build/update.exe' -OutputType WindowsApplication -ReferencedAssemblies 'System.Windows.Forms'
 */

using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace SipToast {
    class Program {
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool SetDefaultDllDirectories(uint directories);
        
        const uint LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800;
        
        static void Main(string[] args) {
            // Enable loading system DLLs from system32
            SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32);
            
            // Get the directory where this executable is located
            string appPath = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            if (string.IsNullOrEmpty(appPath)) {
                appPath = Directory.GetCurrentDirectory();
            }
            
            string batchPath = Path.Combine(appPath, "update.bat");
            string exePath = Path.Combine(appPath, "SIP Toast.exe");
            
            // Try to run update.bat (optional - if it doesn't exist, just launch the app)
            if (File.Exists(batchPath)) {
                try {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = "cmd.exe";
                    psi.Arguments = string.Format("/c \"{0}\"", batchPath);
                    psi.WorkingDirectory = appPath;
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    
                    Process updateProcess = Process.Start(psi);
                    if (updateProcess != null) {
                        updateProcess.WaitForExit();
                    }
                }
                catch (Exception) {
                    // Ignore errors running update.bat
                }
            }
            
            // Now launch the main application
            if (File.Exists(exePath)) {
                try {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = exePath;
                    psi.WorkingDirectory = appPath;
                    psi.UseShellExecute = true;
                    
                    Process.Start(psi);
                }
                catch (Exception ex) {
                    MessageBox.Show(
                        string.Format("Failed to launch SIP Toast.exe: {0}", ex.Message),
                        "Update Launcher Error",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                }
            }
            else {
                MessageBox.Show(
                    string.Format("SIP Toast.exe not found at: {0}", exePath),
                    "Update Launcher Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
