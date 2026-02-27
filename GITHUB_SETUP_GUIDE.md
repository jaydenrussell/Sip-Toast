# GitHub Repository Setup Guide

This guide walks you through setting up your GitHub repository with proper branch protection and CI/CD workflows.

## 🚀 Quick Setup

### 1. Branch Setup (Already Completed ✅)
The develop branch has been automatically created and pushed to GitHub.

**Branches Created:**
- `main` - Production branch (protected)
- `develop` - Integration branch (protected)

### 2. Branch Protection Setup (Manual Step Required)

**⚠️ IMPORTANT: Configure branch protection in GitHub Settings**

1. Go to your GitHub repository: https://github.com/jaydenrussell/Sip-Toast
2. Click on **Settings** tab
3. Navigate to **Branches** in the left sidebar
4. Configure the following branch protection rules:

#### Main Branch Protection
- **Branch name pattern**: `main`
- **Protect matching branches**: ✅ Enable
- **Require a pull request before merging**:
  - ✅ Require pull request reviews before merging
  - ✅ Dismiss stale PR approvals when new commits are pushed
  - ✅ Require review from code owners
  - **Required approving reviews**: `2`
- **Require status checks to pass before merging**:
  - ✅ Require branches to be up to date before merging
  - **Required status checks**:
    - `Code Quality`
    - `Development Build & Test`
    - `Security Scan`
    - `Production Build`
- **Require conversation resolution before merging**: ✅ Enable
- **Require signed commits**: ✅ Enable (recommended)
- **Include administrators**: ✅ Enable
- **Restrict pushes that create files**: ✅ Enable (optional)
- **Require linear history**: ✅ Enable

#### Develop Branch Protection
- **Branch name pattern**: `develop`
- **Protect matching branches**: ✅ Enable
- **Require a pull request before merging**:
  - ✅ Require pull request reviews before merging
  - ✅ Dismiss stale PR approvals when new commits are pushed
  - **Required approving reviews**: `1`
- **Require status checks to pass before merging**:
  - ✅ Require branches to be up to date before merging
  - **Required status checks**:
    - `Code Quality`
    - `Development Build & Test`
    - `Security Scan`
- **Require conversation resolution before merging**: ✅ Enable
- **Require signed commits**: ✅ Enable (recommended)
- **Include administrators**: ❌ Disable
- **Require linear history**: ❌ Disable

## 🔄 Development Workflow

### Feature Development
1. **Create feature branch**:
   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feature/your-feature-name
   ```

2. **Make changes and commit**:
   ```bash
   git add .
   git commit -m "feat: add new feature"
   git push -u origin feature/your-feature-name
   ```

3. **Create Pull Request**:
   - Go to GitHub and create PR from `feature/your-feature-name` to `develop`
   - Wait for CI/CD checks to pass
   - Get required approvals
   - Merge to `develop`

### Integration to Main
1. **Create integration PR**:
   - Create PR from `develop` to `main`
   - Wait for production build and tests
   - Get required approvals (2 reviewers for main)
   - Merge to `main`

2. **Automatic Release**:
   - Merging to `main` triggers production build
   - GitHub release is automatically created
   - Installers are generated for all platforms

### Hotfix Workflow
1. **Create hotfix branch from main**:
   ```bash
   git checkout main
   git pull origin main
   git checkout -b hotfix/fix-name
   ```

2. **Fix and test**:
   ```bash
   # Make fixes
   git add .
   git commit -m "fix: critical bug fix"
   git push -u origin hotfix/fix-name
   ```

3. **Create PR to main**:
   - PR from `hotfix/fix-name` to `main`
   - Fast-track review and merge
   - Automatic release creation

## 📋 CI/CD Workflows

### Development Workflow (`.github/workflows/development.yml`)
**Triggers**: Pull requests, feature branches, hotfix branches
**Purpose**: Code quality and development builds

**Jobs**:
- ✅ **Code Quality**: ESLint, Prettier, type checking, security audit
- ✅ **Development Build & Test**: Multi-platform builds with testing
- ✅ **Dependency Review**: Security and license checking
- ✅ **Security Scan**: Snyk vulnerability scanning
- ✅ **Performance Test**: Performance regression testing

### CI/CD Pipeline (`.github/workflows/ci-cd.yml`)
**Triggers**: Push to `main` and `develop` branches
**Purpose**: Automated builds and releases

**Jobs**:
- ✅ **Development Build**: For non-main branches
- ✅ **Production Build**: For main branch (release candidates)
- ✅ **Create Release**: Automated GitHub releases

### Release Workflow (`.github/workflows/release.yml`)
**Triggers**: Manual dispatch or GitHub releases
**Purpose**: Production releases and package distribution

**Jobs**:
- ✅ **Validate Release**: Version format and repository state
- ✅ **Build Release**: Multi-platform production builds
- ✅ **Create Release Notes**: Automated changelog generation
- ✅ **Publish Release**: GitHub release creation with assets
- ✅ **Deploy Packages**: NPM package publishing

## 🛠️ Available Scripts

### Development
```bash
npm run dev              # Start development server
npm run lint            # Run linting
npm run lint:fix        # Fix linting issues
npm run format          # Format code
npm run format:check    # Check formatting
```

### Building
```bash
npm run build           # Build for development
npm run package         # Build for all platforms
npm run package:win     # Build for Windows
npm run package:mac     # Build for macOS
npm run package:linux   # Build for Linux
```

### Release Management
```bash
npm run release:prepare # Prepare release (interactive)
npm run release:quick   # Quick release
npm run release:bump    # Bump version
npm run release:changelog # Update changelog
npm run setup:branches  # Setup GitHub branches (already run)
```

## 🔒 Security Features

### Branch Protection
- **Main branch**: 2 required reviewers, all status checks required
- **Develop branch**: 1 required reviewer, development status checks required
- **Linear history**: Enforced on main branch
- **Admin overrides**: Disabled on main branch

### Security Scanning
- **Snyk integration**: Vulnerability scanning in CI/CD
- **Dependency review**: Automated security and license checking
- **CodeQL**: GitHub's built-in security analysis

### Code Quality
- **ESLint**: JavaScript linting and code quality
- **Prettier**: Code formatting consistency
- **Security audit**: NPM security vulnerability scanning

## 📊 Monitoring and Notifications

### Success Notifications
- Release completion
- Build success
- Deployment success

### Failure Notifications
- Build failures
- Test failures
- Security scan failures
- Deployment failures

### GitHub Actions Monitoring
- Check the **Actions** tab in your repository
- Monitor workflow runs and logs
- Review failed jobs and fix issues

## 🚀 Next Steps

### 1. Configure Branch Protection
Complete the branch protection setup as described above.

### 2. Test the CI/CD Pipeline
```bash
# Create a test feature branch
git checkout develop
git pull origin develop
git checkout -b feature/test-ci-cd

# Make a small change
echo "// Test comment" >> src/main/main.js
git add src/main/main.js
git commit -m "test: verify CI/CD pipeline"
git push -u origin feature/test-ci-cd

# Create PR and watch GitHub Actions run
```

### 3. Set Up Additional Features
- **Dependabot**: Enable automated dependency updates
- **Code scanning**: Configure additional security tools
- **Issue templates**: Create issue and PR templates
- **Project boards**: Set up GitHub Projects for task management

### 4. Team Collaboration
- **Code owners**: Configure CODEOWNERS file for automatic review requests
- **Team permissions**: Set up team access and permissions
- **Documentation**: Maintain README and contribution guidelines

## 📞 Support

### Common Issues
1. **CI/CD failures**: Check GitHub Actions logs for specific errors
2. **Branch protection**: Ensure all required status checks are configured
3. **Build issues**: Verify Node.js version (20.x required)
4. **Release issues**: Check workflow permissions and secrets

### Getting Help
- Check GitHub Actions logs for detailed error messages
- Review workflow files for configuration issues
- Consult GitHub documentation for branch protection
- Check package.json scripts for available commands

## 🎉 You're All Set!

Your GitHub repository is now configured with:
- ✅ Proper branch structure (main + develop)
- ✅ Comprehensive CI/CD workflows
- ✅ Branch protection rules
- ✅ Security scanning and code quality checks
- ✅ Automated release management
- ✅ Multi-platform build support

Start developing with confidence using professional-grade development workflows!