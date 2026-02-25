const { ipcRenderer } = require('electron');
const path = require('path');

// This installer window should only show progress
// The actual installation is handled by Squirrel.Windows
// So we just need to show a progress message and let Squirrel handle the rest

document.addEventListener('DOMContentLoaded', () => {
  // Set initial progress message
  const statusElement = document.getElementById('status');
  const progressBar = document.getElementById('progress-bar');

  if (statusElement) {
    statusElement.textContent = 'Preparing installation...';
  }

  if (progressBar) {
    progressBar.style.width = '10%';
  }

  // Simulate progress updates (Squirrel.Windows handles the actual installation)
  let progress = 10;
  const progressInterval = setInterval(() => {
    progress += 5;
    if (progressBar) {
      progressBar.style.width = `${Math.min(progress, 90)}%`;
    }

    if (progress >= 90) {
      clearInterval(progressInterval);
      if (statusElement) {
        statusElement.textContent = 'Finalizing installation...';
      }
    }
  }, 500);

  // The actual installation is handled by the main process
  // This window just provides visual feedback
  // When Squirrel.Windows completes, it will automatically restart the application
});
