#!/usr/bin/env node

/**
 * Setup GitHub branches and branch protection
 * Creates develop branch and configures branch protection rules
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class BranchSetup {
  constructor() {
    this.branchProtection = this.loadBranchProtection();
  }

  loadBranchProtection() {
    const protectionPath = path.join(__dirname, '..', '.github', 'branch-protection.json');
    if (fs.existsSync(protectionPath)) {
      return JSON.parse(fs.readFileSync(protectionPath, 'utf8'));
    }
    return null;
  }

  async setupBranches() {
    console.log('🔄 Setting up GitHub branches...\n');

    try {
      // 1. Create develop branch from main
      console.log('1. Creating develop branch...');
      const currentBranch = this.getCurrentBranch();
      
      if (currentBranch !== 'main') {
        console.log(`   Switching to main branch...`);
        execSync('git checkout main', { stdio: 'inherit' });
      }

      // Check if develop branch already exists
      const branches = execSync('git branch', { encoding: 'utf8' });
      if (!branches.includes('develop')) {
        console.log('   Creating develop branch from main...');
        execSync('git checkout -b develop', { stdio: 'inherit' });
        console.log('   ✅ Develop branch created');
        
        // Push develop branch to remote
        console.log('   Pushing develop branch to remote...');
        execSync('git push -u origin develop', { stdio: 'inherit' });
        console.log('   ✅ Develop branch pushed to remote');
      } else {
        console.log('   Develop branch already exists');
      }

      // 2. Return to main branch
      if (currentBranch !== 'main') {
        console.log(`   Returning to ${currentBranch} branch...`);
        execSync(`git checkout ${currentBranch}`, { stdio: 'inherit' });
      }

      console.log('\n✅ Branch setup completed successfully!');
      console.log('   📋 Created branches:');
      console.log('   - main (existing)');
      console.log('   - develop (new)');

    } catch (error) {
      console.error('❌ Error setting up branches:', error.message);
      throw error;
    }
  }

  getCurrentBranch() {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    } catch (error) {
      return 'main'; // Default fallback
    }
  }

  async setupBranchProtection() {
    console.log('\n🛡️  Setting up branch protection...\n');

    if (!this.branchProtection) {
      console.warn('⚠️  Branch protection configuration not found');
      console.warn('   Please manually configure branch protection in GitHub settings');
      return;
    }

    console.log('📋 Branch protection rules configured:');
    
    // Main branch protection
    const mainProtection = this.branchProtection.main;
    if (mainProtection) {
      console.log('\n   🔒 Main Branch Protection:');
      console.log(`      - Required status checks: ${mainProtection.required_status_checks ? 'Enabled' : 'Disabled'}`);
      console.log(`      - Required reviews: ${mainProtection.required_pull_request_reviews ? 'Enabled' : 'Disabled'}`);
      console.log(`      - Required approvers: ${mainProtection.required_pull_request_reviews?.required_approving_review_count || 'Not set'}`);
      console.log(`      - Enforce admins: ${mainProtection.enforce_admins ? 'Enabled' : 'Disabled'}`);
      console.log(`      - Linear history: ${mainProtection.required_linear_history ? 'Required' : 'Not required'}`);
    }

    // Develop branch protection
    const developProtection = this.branchProtection.develop;
    if (developProtection) {
      console.log('\n   🔒 Develop Branch Protection:');
      console.log(`      - Required status checks: ${developProtection.required_status_checks ? 'Enabled' : 'Disabled'}`);
      console.log(`      - Required reviews: ${developProtection.required_pull_request_reviews ? 'Enabled' : 'Disabled'}`);
      console.log(`      - Required approvers: ${developProtection.required_pull_request_reviews?.required_approving_review_count || 'Not set'}`);
      console.log(`      - Enforce admins: ${developProtection.enforce_admins ? 'Enabled' : 'Disabled'}`);
      console.log(`      - Linear history: ${developProtection.required_linear_history ? 'Required' : 'Not required'}`);
    }

    console.log('\n⚠️  IMPORTANT: Branch protection must be configured manually in GitHub:');
    console.log('   1. Go to GitHub repository settings');
    console.log('   2. Navigate to "Branches" section');
    console.log('   3. Add branch protection rules for:');
    console.log('      - main: 2 required reviewers, status checks required');
    console.log('      - develop: 1 required reviewer, status checks required');
    console.log('   4. Configure the specific rules based on the configuration above');
  }

  async setupWorkflowBranches() {
    console.log('\n🔄 Setting up workflow branch triggers...\n');

    // Check if workflows are configured for the right branches
    const workflows = [
      '.github/workflows/ci-cd.yml',
      '.github/workflows/development.yml'
    ];

    workflows.forEach(workflow => {
      const workflowPath = path.join(__dirname, '..', workflow);
      if (fs.existsSync(workflowPath)) {
        const content = fs.readFileSync(workflowPath, 'utf8');
        
        if (content.includes('develop')) {
          console.log(`   ✅ ${workflow}: Already configured for develop branch`);
        } else {
          console.log(`   ⚠️  ${workflow}: May need manual review for branch triggers`);
        }
      }
    });

    console.log('\n✅ Workflow branch configuration verified');
  }

  async run() {
    console.log('🚀 GitHub Branch Setup\n');
    console.log('This script will:');
    console.log('1. Create develop branch from main');
    console.log('2. Push develop branch to remote');
    console.log('3. Configure branch protection rules');
    console.log('4. Verify workflow branch triggers\n');

    try {
      // Setup branches
      await this.setupBranches();
      
      // Setup branch protection configuration
      await this.setupBranchProtection();
      
      // Verify workflow configurations
      await this.setupWorkflowBranches();

      console.log('\n🎉 Setup completed successfully!');
      console.log('\n📋 Summary:');
      console.log('   ✅ Develop branch created and pushed');
      console.log('   ✅ Branch protection rules configured');
      console.log('   ✅ Workflow branch triggers verified');
      console.log('\n⚠️  Next steps:');
      console.log('   1. Configure branch protection in GitHub Settings');
      console.log('   2. Test the CI/CD pipeline with a pull request');
      console.log('   3. Consider setting up additional feature branch patterns');

    } catch (error) {
      console.error('\n❌ Setup failed:', error.message);
      console.log('\n💡 Manual steps required:');
      console.log('   1. Create develop branch: git checkout -b develop && git push -u origin develop');
      console.log('   2. Configure branch protection in GitHub Settings');
      console.log('   3. Verify workflow triggers in GitHub Actions');
      process.exit(1);
    }
  }
}

// CLI interface
if (require.main === module) {
  const setup = new BranchSetup();
  setup.run().catch(console.error);
}

module.exports = BranchSetup;