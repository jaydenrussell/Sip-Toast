const fs = require('fs');
const path = require('path');

/**
 * Removes unnecessary locale files to reduce installer size
 * Keeps only en-US locale
 * 
 * This is called by electron-builder's afterPack hook
 * The context parameter contains: { appOutDir, ... }
 */
function optimizeBuild(context) {
  // Handle both electron-builder context object and direct path
  const appOutDir = typeof context === 'string' ? context : (context?.appOutDir || context?.outDir);
  
  if (!appOutDir) {
    console.warn('No appOutDir provided, skipping locale optimization');
    return;
  }

  const localesDir = path.join(appOutDir, 'locales');
  
  if (!fs.existsSync(localesDir)) {
    console.log('Locales directory not found, skipping optimization');
    return;
  }

  const files = fs.readdirSync(localesDir);
  const keepLocales = ['en-US.pak', 'en-GB.pak']; // Keep English variants
  let removedCount = 0;

  files.forEach(file => {
    if (!keepLocales.includes(file)) {
      const filePath = path.join(localesDir, file);
      try {
        fs.unlinkSync(filePath);
        removedCount++;
      } catch (error) {
        console.warn(`Failed to remove ${file}: ${error.message}`);
      }
    }
  });

  console.log(`✓ Removed ${removedCount} unnecessary locale files`);
  console.log(`✓ Kept ${keepLocales.length} English locale files`);
}

// Export for electron-builder afterPack hook
module.exports = optimizeBuild;

// Allow direct execution for testing
if (require.main === module) {
  const appOutDir = process.argv[2] || path.join(__dirname, '..', 'dist', 'win-unpacked');
  optimizeBuild(appOutDir);
}
