#!/usr/bin/env node

/**
 * Development workflow script for SIP Caller ID
 * Handles version bumping, changelog generation, and release preparation
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class DevWorkflow {
  constructor() {
    this.packageJson = this.loadPackageJson();
    this.changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
  }

  loadPackageJson() {
    const packagePath = path.join(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  }

  savePackageJson() {
    const packagePath = path.join(__dirname, '..', 'package.json');
    fs.writeFileSync(packagePath, JSON.stringify(this.packageJson, null, 2) + '\n');
  }

  getCurrentVersion() {
    return this.packageJson.version;
  }

  bumpVersion(type = 'patch') {
    const [major, minor, patch] = this.getCurrentVersion().split('.').map(Number);
    
    let newVersion;
    switch (type.toLowerCase()) {
      case 'major':
        newVersion = `${major + 1}.0.0`;
        break;
      case 'minor':
        newVersion = `${major}.${minor + 1}.0`;
        break;
      case 'patch':
      default:
        newVersion = `${major}.${minor}.${patch + 1}`;
        break;
    }
    
    this.packageJson.version = newVersion;
    this.savePackageJson();
    
    console.log(`✅ Version bumped from ${this.getCurrentVersion()} to ${newVersion}`);
    return newVersion;
  }

  generateChangelog(version, changes = []) {
    const currentDate = new Date().toISOString().split('T')[0];
    const newEntry = `## [${version}] - ${currentDate}\n\n`;
    
    let changesText = '';
    if (changes.length > 0) {
      changesText = changes.map(change => `- ${change}`).join('\n') + '\n\n';
    } else {
      // Auto-generate from git commits
      try {
        const commits = execSync('git log --pretty=format:"- %s (%h)" HEAD^..HEAD', { encoding: 'utf8' })
          .trim()
          .split('\n')
          .filter(line => line.trim());
        
        changesText = commits.length > 0 ? commits.join('\n') + '\n\n' : '- Auto-generated release\n\n';
      } catch (error) {
        console.warn('⚠️ Could not generate changelog from git commits');
        changesText = '- Auto-generated release\n\n';
      }
    }
    
    const newChangelog = newEntry + changesText;
    
    // Read existing changelog
    let existingChangelog = '';
    if (fs.existsSync(this.changelogPath)) {
      existingChangelog = fs.readFileSync(this.changelogPath, 'utf8');
    }
    
    // Insert new entry at the top, after the header
    const headerEnd = existingChangelog.indexOf('\n\n');
    const header = existingChangelog.substring(0, headerEnd + 2);
    const content = existingChangelog.substring(headerEnd + 2);
    
    const updatedChangelog = header + newChangelog + content;
    fs.writeFileSync(this.changelogPath, updatedChangelog);
    
    console.log(`✅ Changelog updated for version ${version}`);
  }

  createReleaseBranch(version) {
    const branchName = `release/v${version}`;
    
    try {
      execSync(`git checkout -b ${branchName}`, { stdio: 'inherit' });
      console.log(`✅ Created and switched to branch: ${branchName}`);
      return branchName;
    } catch (error) {
      console.error(`❌ Failed to create release branch: ${error.message}`);
      throw error;
    }
  }

  commitChanges(version) {
    try {
      execSync('git add package.json CHANGELOG.md', { stdio: 'inherit' });
      execSync(`git commit -m "chore: bump version to ${version}"`, { stdio: 'inherit' });
      console.log(`✅ Committed version bump for ${version}`);
    } catch (error) {
      console.warn('⚠️ No changes to commit or already committed');
    }
  }

  pushToRemote(branchName) {
    try {
      execSync(`git push -u origin ${branchName}`, { stdio: 'inherit' });
      console.log(`✅ Pushed ${branchName} to remote`);
    } catch (error) {
      console.error(`❌ Failed to push to remote: ${error.message}`);
      throw error;
    }
  }

  createPullRequest(branchName) {
    console.log(`\n🚀 Next steps:`);
    console.log(`1. Create a Pull Request from ${branchName} to main`);
    console.log(`2. Wait for CI/CD checks to pass`);
    console.log(`3. Merge the PR to trigger production build and release`);
    console.log(`4. The release workflow will automatically create a GitHub release`);
  }

  async prepareRelease(type = 'patch', changes = []) {
    console.log('🔄 Preparing release...\n');
    
    // 1. Bump version
    const newVersion = this.bumpVersion(type);
    
    // 2. Generate changelog
    this.generateChangelog(newVersion, changes);
    
    // 3. Create release branch
    const branchName = this.createReleaseBranch(newVersion);
    
    // 4. Commit changes
    this.commitChanges(newVersion);
    
    // 5. Push to remote
    this.pushToRemote(branchName);
    
    // 6. Instructions
    this.createPullRequest(branchName);
    
    console.log(`\n✅ Release preparation complete!`);
    console.log(`   Version: ${newVersion}`);
    console.log(`   Branch: ${branchName}`);
  }

  async quickRelease(type = 'patch') {
    console.log('🚀 Creating quick release...\n');
    
    const newVersion = this.bumpVersion(type);
    this.generateChangelog(newVersion);
    this.commitChanges(newVersion);
    
    console.log(`✅ Quick release ${newVersion} ready for push`);
    console.log(`   Run: git push && git push --tags`);
  }
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const workflow = new DevWorkflow();
  
  const command = args[0];
  const type = args[1] || 'patch';
  const changes = args.slice(2);
  
  switch (command) {
    case 'prepare':
      workflow.prepareRelease(type, changes).catch(console.error);
      break;
    case 'quick':
      workflow.quickRelease(type).catch(console.error);
      break;
    case 'bump':
      workflow.bumpVersion(type);
      break;
    case 'changelog':
      workflow.generateChangelog(workflow.getCurrentVersion(), changes);
      break;
    default:
      console.log(`
Usage: node dev-workflow.js <command> [options]

Commands:
  prepare [type] [changes...]  Prepare a full release (creates branch, PR)
  quick [type]                 Create a quick release (bump and commit)
  bump [type]                  Bump version only
  changelog [changes...]       Update changelog only

Types: major, minor, patch (default)

Examples:
  node dev-workflow.js prepare patch "Bug fix" "Feature added"
  node dev-workflow.js quick minor
  node dev-workflow.js bump major
      `);
  }
}

module.exports = DevWorkflow;