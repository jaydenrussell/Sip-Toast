const fs = require('fs');
const path = require('path');

/**
 * Electron-builder hook: msiProjectCreated
 * This runs after the MSI WiX project is created, allowing us to inject custom fragments
 * @param {Object} context - The build context from electron-builder
 */
exports.default = async function(context) {
  // The context for msiProjectCreated has different structure
  // Try to get project directory from various sources
  let projectDir = process.cwd();
  if (context) {
    projectDir = context.projectDir || context.packager?.projectDir || projectDir;
  }
  
  const outDir = context?.outDir;
  const packager = context?.packager || context;
  
  console.log('Injecting WiX fragments for running process detection and update launcher...');
  console.log('Project dir:', projectDir);
  console.log('Context keys:', context ? Object.keys(context) : 'no context');
  
  // Try to get the WiX file path from context if available
  if (context && context.path) {
    console.log('Found path in context:', context.path);
  }
  
  // Check if context has platformPackager with wxsFile
  if (context && context.platformPackager) {
    console.log('PlatformPackager found');
    const pp = context.platformPackager;
    if (pp.wxsFile) {
      console.log('Found wxsFile in platformPackager:', pp.wxsFile);
    }
  }
  
  // The WiX project files are typically in a temp directory
  // electron-builder creates them in a platformPackager-specific location
  const possiblePaths = [];
  
  if (outDir) {
    possiblePaths.push(path.join(outDir, 'win-unpacked'));
  }
  
  if (projectDir) {
    possiblePaths.push(path.join(projectDir, 'dist', 'win-unpacked'));
  }
  
  if (packager && packager.projectDir) {
    possiblePaths.push(path.join(packager.projectDir, 'dist', 'win-unpacked'));
  }
  
  // Also check in the build temp directory (electron-builder's internal structure)
  const buildDir = path.join(projectDir, 'build');
  if (fs.existsSync(buildDir)) {
    possiblePaths.push(buildDir);
  }
  
  // Find the generated .wxs file
  let wxsFile = null;
  for (const basePath of possiblePaths) {
    if (fs.existsSync(basePath)) {
      const found = findWxsFile(basePath);
      if (found) {
        wxsFile = found;
        break;
      }
    }
  }
  
  // Also try to find in the packager's internal directories
  const packagerProjectDir = (packager && packager.projectDir) || projectDir || process.cwd();
  if (!wxsFile && packagerProjectDir) {
    const tempDir = path.join(packagerProjectDir, 'dist', 'win', 'msi');
    if (fs.existsSync(tempDir)) {
      const found = findWxsFile(tempDir);
      if (found) {
        wxsFile = found;
      }
    }
  }
  
  if (!wxsFile) {
    // Try to find in common electron-builder temp locations and user temp
    const os = require('os');
    const tempBase = os.tmpdir();
    const userProfile = process.env.USERPROFILE || process.env.HOME || '';
    
    const tempPaths = [
      path.join(tempBase, 'electron-builder'),
      path.join(userProfile, 'AppData', 'Local', 'Temp', 'electron-builder'),
      path.join(userProfile, 'AppData', 'Local', 'Temp'),
      tempBase
    ];
    
    // Also search recursively in temp directories
    for (const tempPath of tempPaths) {
      if (fs.existsSync(tempPath)) {
        const found = findWxsFile(tempPath);
        if (found) {
          wxsFile = found;
          break;
        }
      }
    }
    
    // Last resort: search the entire project dist directory recursively
    if (!wxsFile && projectDir) {
      const distPath = path.join(projectDir, 'dist');
      if (fs.existsSync(distPath)) {
        const found = findWxsFile(distPath);
        if (found) {
          wxsFile = found;
        }
      }
    }
  }
  
  if (!wxsFile) {
    console.warn('⚠️  Could not find generated WiX source file. Fragment injection skipped.');
    console.warn('   This is normal if building for the first time or if the build structure changed.');
    return;
  }
  
  // Inject both fragments: check-running-process.wxs and update-exe.wxs
  const fragments = [
    { file: 'check-running-process.wxs', marker: 'CheckRunningProcess' },
    { file: 'update-exe.wxs', marker: 'UpdateLauncher' }
  ];
  
  try {
    let wxsContent = fs.readFileSync(wxsFile, 'utf8');
    let injectedAny = false;
    
    for (const fragment of fragments) {
      const fragmentPath = path.join(projectDir || process.cwd(), 'build', fragment.file);
      
      if (!fs.existsSync(fragmentPath)) {
        console.warn(`⚠️  Custom WiX fragment not found at: ${fragmentPath}`);
        continue;
      }
      
      // Check if this fragment is already injected
      if (wxsContent.includes(fragment.marker)) {
        console.log(`✓ Fragment ${fragment.file} already injected`);
        continue;
      }
      
      // Read fragment content
      const fragmentContent = fs.readFileSync(fragmentPath, 'utf8');
      
      // Extract the fragment inner content (without outer Wix/Fragment tags)
      const fragmentMatch = fragmentContent.match(/<Fragment>([\s\S]*?)<\/Fragment>/);
      if (!fragmentMatch) {
        console.error(`❌ Could not parse fragment content for ${fragment.file}`);
        continue;
      }
      
      const fragmentInner = fragmentMatch[1];
      
      // Find the closing </Product> tag and insert our fragment before it
      const productEndMatch = wxsContent.match(/(\s*)<\/Product>/);
      if (!productEndMatch) {
        console.error(`❌ Could not find </Product> tag in generated file`);
        continue;
      }
      
      const productIndent = productEndMatch[1] || '  ';
      const insertPosition = productEndMatch.index;
      
      // Insert the fragment before </Product>
      wxsContent = wxsContent.slice(0, insertPosition) + 
                  productIndent + fragmentInner.trim().split('\n').join('\n' + productIndent) + '\n' +
                  wxsContent.slice(insertPosition);
      
      console.log(`✓ Successfully injected WiX fragment: ${fragment.file}`);
      injectedAny = true;
    }
    
    if (injectedAny) {
      fs.writeFileSync(wxsFile, wxsContent, 'utf8');
      console.log('✓ All fragments injected into:', path.basename(wxsFile));
    }
  } catch (error) {
    console.error('❌ Error injecting fragments:', error.message);
  }
};

function findWxsFile(dir) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      
      if (entry.isDirectory()) {
        const found = findWxsFile(fullPath);
        if (found) return found;
      } else if (entry.isFile() && entry.name.endsWith('.wxs') && 
                 !entry.name.includes('check-running-process')) {
        return fullPath;
      }
    }
  } catch (error) {
    // Ignore errors
  }
  
  return null;
}

