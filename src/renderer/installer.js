const { ipcRenderer } = require('electron');
const path = require('path');

document.getElementById('installBtn').addEventListener('click', async () => {
  try {
    // Show installation progress
    const installBtn = document.getElementById('installBtn');
    installBtn.textContent = 'Installing...';
    installBtn.disabled = true;

    // Download the installer
    const downloadUrl = 'https://github.com/jaydenrussell/Sip-Toast/releases/latest/download/SIPCallerID-Setup.exe';
    const downloadPath = path.join(require('electron').remote.app.getPath('temp'), 'SIPCallerID-Setup.exe');

    const response = await fetch(downloadUrl);
    const blob = await response.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());

    fs.writeFileSync(downloadPath, buffer);

    // Install the application
    const { exec } = require('child_process');
    exec(`"${downloadPath}"`, (error, stdout, stderr) => {
      if (error) {
        console.error('Error installing:', error);
        installBtn.textContent = 'Install';
        installBtn.disabled = false;
        return;
      }

      // Show success message
      installBtn.textContent = 'Installed Successfully!';
      installBtn.style.background = 'linear-gradient(135deg, #4caf50 0%, #45a049 100%)';

      // Restart the application
      setTimeout(() => {
        require('electron').remote.app.relaunch();
        require('electron').remote.app.quit();
      }, 2000);
    });
  } catch (error) {
    console.error('Installation failed:', error);
    document.getElementById('installBtn').textContent = 'Install';
    document.getElementById('installBtn').disabled = false;
  }
});