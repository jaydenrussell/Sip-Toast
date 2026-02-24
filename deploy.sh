#!/bin/bash

echo "Deploying update installer to GitHub..."

# Add all files
git add .

# Commit changes
git commit -m "Add update installer with seamless update flow"

# Tag the release
git tag -a v1.0.0 -m "Update installer v1.0.0"

# Push changes and tags
git push origin main --tags

echo "Deployment completed successfully!"