#!/bin/bash
# Script to build and push the sockperf exporter Docker image to ECR

set -e

# Check if repository URI is provided
if [ -z "$1" ]; then
    echo "Error: ECR repository URI is required."
    echo "Usage: $0 <ecr-repository-uri>"
    echo "Example: $0 123456789012.dkr.ecr.us-east-1.amazonaws.com/sockperf-exporter"
    exit 1
fi

REPO_URI=$1
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXPORTER_DIR="$SCRIPT_DIR/exporter"

echo "Building sockperf exporter Docker image..."
cd "$EXPORTER_DIR"
docker build -t sockperf-exporter:latest .

echo "Tagging image with ECR repository URI: $REPO_URI"
docker tag sockperf-exporter:latest "$REPO_URI:latest"

echo "Logging in to ECR..."
# Extract region from repository URI
REGION=$(echo "$REPO_URI" | cut -d. -f4)
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$(echo "$REPO_URI" | cut -d/ -f1)"

echo "Pushing image to ECR..."
docker push "$REPO_URI:latest"

echo "Image successfully built and pushed to ECR: $REPO_URI:latest"
