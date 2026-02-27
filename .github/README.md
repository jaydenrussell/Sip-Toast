# CI/CD Pipeline Documentation

This repository uses GitHub Actions for automated continuous integration and deployment.

## Workflow Overview

### Development Environment (`development.yml`)
- **Triggers**: Pull requests, feature branches, hotfix branches
- **Purpose**: Code quality checks and development builds
- **Jobs**:
  - Code Quality: ESLint, Prettier, type checking, security audit
  - Development Build & Test: Multi-platform builds with testing
  - Dependency Review: Security scanning for PRs
  - Security Scan: Snyk security analysis
  - Performance Test: Performance regression testing

### CI/CD Pipeline (`ci-cd.yml`)
- **Triggers**: Push to `main` and `develop` branches
- **Purpose**: Automated builds and releases
- **Jobs**:
  - Development Build: For non-main branches (feature development)
  - Production Build: For main branch (release candidates)
  - Create Release: Automated GitHub releases

### Release Workflow (`release.yml`)
- **Triggers**: Manual dispatch or GitHub releases
- **Purpose**: Production releases and package distribution
- **Jobs**:
  - Validate Release: Version format and repository state checks
  - Build Release: Multi-platform production builds
  - Create Release Notes: Automated changelog generation
  - Publish Release: GitHub release creation with assets
  - Deploy Packages: NPM package publishing
  - Notify: Stakeholder notifications

## Branch Strategy

### Main Branch
- **Purpose**: Production-ready code
- **Protection**: 
  - 2 code owner approvals required
  - All status checks must pass
  - Linear history enforced
  - Admin overrides disabled

### Develop Branch
- **Purpose**: Integration branch for features
- **Protection**:
  - 1 code owner approval required
  - Status checks required
  - Linear history not enforced

### Feature Branches
- **Pattern**: `feature/*`, `hotfix/*`, `bugfix/*`
- **Purpose**: Individual feature development
- **Process**: PR to develop → merge → PR to main → release

## Development Commands

### Using the Development Workflow Script

```bash
# Prepare a full release (creates branch, updates changelog, commits)
node scripts/dev-workflow.js prepare patch "Bug fix description"

# Quick release (bump version and commit)
node scripts/dev-workflow.js quick minor

# Bump version only
node scripts/dev-workflow.js bump major

# Update changelog only
node scripts/dev-workflow.js changelog "New feature added"
```

### Available NPM Scripts

```bash
# Development
npm run dev              # Start development server
npm run lint            # Run linting
npm run lint:fix        # Fix linting issues
npm run format          # Format code
npm run format:check    # Check formatting

# Building
npm run build           # Build for development
npm run package         # Build for all platforms
npm run package:win     # Build for Windows
npm run package:mac     # Build for macOS
npm run package:linux   # Build for Linux

# Release Management
npm run release:prepare # Prepare release (interactive)
npm run release:quick   # Quick release
npm run release:bump    # Bump version
npm run release:changelog # Update changelog
```

## Environment Variables

### Required Secrets
- `GITHUB_TOKEN`: Auto-provided by GitHub Actions
- `SNYK_TOKEN`: For security scanning (optional)
- `NPM_TOKEN`: For NPM package publishing (optional)

### Environment Variables
- `NODE_VERSION`: Node.js version (18.x)
- `ELECTRON_VERSION`: Electron version (28.0.0)

## Release Process

### Automated Release (Recommended)
1. Create feature branch: `git checkout -b feature/new-feature`
2. Make changes and commit
3. Create PR to `develop` branch
4. Once approved, merge to `develop`
5. Create PR from `develop` to `main`
6. Merge to `main` triggers production build and release

### Manual Release
1. Use development workflow script: `npm run release:prepare patch`
2. Create PR and merge to main
3. Release workflow automatically creates GitHub release

### Quick Release (For Hotfixes)
1. Use: `npm run release:quick patch`
2. Push changes: `git push && git push --tags`
3. Release workflow creates GitHub release

## Artifact Management

### Development Artifacts
- Retention: 7 days
- Purpose: Testing and debugging
- Access: Via GitHub Actions artifacts

### Production Artifacts
- Retention: 30 days
- Purpose: Release candidates
- Access: Via GitHub Actions artifacts

### Release Assets
- Retention: Permanent (with release)
- Purpose: Production distribution
- Access: Via GitHub releases

## Monitoring and Notifications

### Success Notifications
- Release completion
- Build success
- Deployment success

### Failure Notifications
- Build failures
- Test failures
- Security scan failures
- Deployment failures

## Best Practices

### Code Quality
- All PRs must pass linting and formatting
- Tests should be included for new features
- Security vulnerabilities must be addressed
- Performance regressions should be minimized

### Releases
- Use semantic versioning (MAJOR.MINOR.PATCH)
- Include meaningful changelog entries
- Test releases on multiple platforms
- Notify stakeholders of production releases

### Security
- Keep dependencies up to date
- Address security vulnerabilities promptly
- Use secrets for sensitive information
- Review dependency licenses

## Troubleshooting

### Common Issues

**Build Failures**
- Check Node.js and Electron versions
- Verify dependencies are installed
- Check for platform-specific issues

**Release Failures**
- Ensure version format is correct (X.Y.Z)
- Check for untracked changes
- Verify GitHub token permissions

**Security Scan Failures**
- Review and address vulnerabilities
- Update dependencies if needed
- Check license compatibility

### Getting Help
- Check GitHub Actions logs for detailed error messages
- Review workflow files for configuration issues
- Consult Electron and Node.js documentation
- Check GitHub Actions documentation