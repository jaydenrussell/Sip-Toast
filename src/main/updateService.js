/**
 * updateService.js
 * 
 * Handles version management for Squirrel.Windows installer.
 * Ensures only one version is installed at a time and overwrites
 * previous versions regardless of the displayed version.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Helper: compare version strings
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Helper: get currently installed version folder
async function getInstalledVersion() {
  try {
    const versionsPath = path.join(__dirname, '..', '..', '..', 'versions');
    const folders = await fs.promises.readdir(versionsPath, { withFileTypes: true });
    const exeFolders = folders.filter(f => f.isDirectory() && f.name.endsWith('.exe'));
    if (exeFolders.length === 0) return null;
    // Return the first installed version (or implement more sophisticated selection)
    return exeFolders[0].name;
  } catch (err) {
    console.error('Failed to detect installed version:', err);
    return null;
  }
}

// Helper: uninstall a specific version
async function uninstallVersion(version) {
  const versionsPath = path.join(__dirname, '..', '..', '..', 'versions');
  const versionPath = path.join(versionsPath, version);
  try {
    await fs.promises.rm(versionPath, { recursive: true, force: true });
    console.log(`Uninstalled previous version: ${version}`);
  } catch (err) {
    console.error(`Failed to uninstall version ${version}:`, err);
  }
}

// Main export
module.exports = {
  /**
   * Checks if a new version should be installed.
   * If a version is already installed, it will be overwritten.
   * 
   * @param {string} newVersion - The version to install.
   * @returns {Promise<void>}
   */
  async ensureSingleVersionInstallation(newVersion) {
    // Determine the displayed version (could be read from manifest or UI)
    const displayedVersion = newVersion; // In many cases the displayed version matches the installer version

    // Get currently installed version
    const installedVersion = await getInstalledVersion();

    // If a different version is installed, uninstall it
    if (installedVersion && installedVersion !== displayedVersion) {
      await uninstallVersion(installedVersion);
    }

    // Proceed with installing the new version
    await this._install(newVersion);
  },

  /**
   * Internal method to install a version.
   * Replace this with actual installation logic.
   * 
   * @param {string} version - Version string to install.
   * @returns {Promise<void>}
   */
  async _install(version) {
    // Example: copy installer files to the versions directory
    const versionsPath = path.join(__dirname, '..', '..', '..', 'versions');
    const versionPath = path.join(versionsPath, version);

    // Ensure the version directory exists
    await fs.promises.mkdir(versionPath, { recursive: true });

    // TODO: Add actual installation steps (e.g., extract files, register services)
    console.log(`Installing version ${version}...`);
  }
};