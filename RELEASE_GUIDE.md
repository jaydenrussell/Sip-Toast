# Release Guide

This guide explains how to create GitHub releases with version tags and upload MSI installer files automatically.

## Overview

There are two ways to create releases:

1. **Automatic (GitHub Actions)** - Automatically creates releases when you push version changes
2. **Manual (Local Script)** - Create releases manually using a local script

## Automatic Releases (GitHub Actions)

### Setup

1. The GitHub Actions workflow (`.github/workflows/release.yml`) is already configured
2. It triggers automatically when:
   - You push changes to `package.json` (version changes) on `main` or `master` branch
   - You manually trigger it from the GitHub Actions tab

### How It Works

1. When you commit a version change to `package.json` and push to main/master:
   ```bash
   git add package.json
   git commit -m "Bump version to 0.67.72"
   git push origin main
   ```

2. GitHub Actions will:
   - Build the application
   - Create a version tag (e.g., `v0.67.72`)
   - Create a GitHub release
   - Upload the MSI installer as a release asset

### Manual Trigger

You can also manually trigger a release:

1. Go to your repository on GitHub
2. Click on "Actions" tab
3. Select "Build and Release" workflow
4. Click "Run workflow"
5. Optionally specify a version (or leave empty to use package.json version)

## Manual Releases (Local Script)

### Prerequisites

1. **Install GitHub CLI**:
   ```bash
   # Windows (using winget)
   winget install GitHub.cli
   
   # Or download from: https://cli.github.com/
   ```

2. **Authenticate with GitHub**:
   ```bash
   gh auth login
   ```

3. **Build the application**:
   ```bash
   npm run package
   ```

### Creating a Release

#### Option 1: Use version from package.json
```bash
npm run release
```

#### Option 2: Specify a version
```bash
node scripts/create-release.js 0.67.72
```

#### Option 3: Build and release in one command
```bash
npm run build-and-release
```

### What the Script Does

1. Validates the version format
2. Checks if GitHub CLI is installed and authenticated
3. Finds the MSI installer in `dist/` directory
4. Checks if the tag already exists (prompts to recreate if needed)
5. Creates a Git tag
6. Pushes the tag to GitHub
7. Creates a GitHub release with the MSI installer attached

## Version Management

The version is automatically incremented when you run:
```bash
npm run package
```

This runs the `prepackage` script which increments the patch version (e.g., `0.67.71` → `0.67.72`).

To manually set a version, edit `package.json`:
```json
{
  "version": "0.67.72"
}
```

## Release Notes

Release notes are automatically generated and include:
- Version number
- Installation instructions
- Auto-update information
- Link to commit history

You can customize the release notes by editing:
- `.github/workflows/release.yml` (for GitHub Actions)
- `scripts/create-release.js` (for manual releases)

## Troubleshooting

### GitHub Actions Fails

1. **Check repository permissions**: Ensure the workflow has permission to create releases
   - Go to Settings → Actions → General
   - Under "Workflow permissions", select "Read and write permissions"

2. **Check build errors**: Review the Actions log for build failures

3. **Verify package.json**: Ensure version format is correct (`x.y.z`)

### Manual Script Fails

1. **GitHub CLI not found**:
   ```bash
   # Verify installation
   gh --version
   
   # If not installed, install from: https://cli.github.com/
   ```

2. **Not authenticated**:
   ```bash
   gh auth login
   ```

3. **No MSI file found**:
   ```bash
   # Build the application first
   npm run package
   ```

4. **Tag already exists**:
   - The script will prompt you to delete and recreate it
   - Or manually delete: `git tag -d v0.67.72 && git push origin :refs/tags/v0.67.72`

## Best Practices

1. **Version Format**: Always use semantic versioning (`MAJOR.MINOR.PATCH`)
2. **Commit Messages**: Use clear commit messages for version bumps
3. **Testing**: Test the MSI installer before creating a release
4. **Release Notes**: Update release notes with significant changes
5. **Tagging**: Tags are created automatically - don't create them manually

## Auto-Update Integration

Once a release is created, users with SIP Toast installed will:
1. See the update in their "Check for Updates" status
2. Be able to download and install automatically (if auto-update is enabled)
3. Get notified based on their check frequency setting (daily/weekly/monthly)

The app checks for updates from GitHub releases using the version tags you create.
