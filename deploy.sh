#!/bin/bash
# Script to deploy the ENA Express Lab Pulumi stack to a specific AWS account and region

# Function to display usage information
show_usage() {
    echo 1>&2 "Usage: ./deploy.sh <account-id> <region> [options]"
    echo 1>&2 ""
    echo 1>&2 "Options:"
    echo 1>&2 "  --with-monitoring    Deploy the monitoring infrastructure along with the main stack"
    echo 1>&2 "  --stack <name>       Use a specific stack name (default: dev)"
    echo 1>&2 "  destroy              Destroy the stack instead of deploying it"
    echo 1>&2 ""
    echo 1>&2 "Examples:"
    echo 1>&2 "  ./deploy.sh 123456789012 us-east-1"
    echo 1>&2 "  ./deploy.sh 123456789012 us-east-1 --with-monitoring"
    echo 1>&2 "  ./deploy.sh 123456789012 us-east-1 --stack prod"
    echo 1>&2 "  ./deploy.sh 123456789012 us-east-1 destroy"
}

# Check if at least 2 arguments are provided (account and region)
if [[ $# -lt 2 ]]; then
    echo 1>&2 "Error: Insufficient arguments."
    show_usage
    exit 1
fi

# Set AWS credentials
export AWS_ACCOUNT=$1
export AWS_REGION=$2

# Shift the first two arguments (account and region)
shift; shift

# Initialize variables
STACK_NAME="dev"
CONFIG_ARGS=""
DESTROY=false

# Process options
while [[ $# -gt 0 ]]; do
    case "$1" in
        --with-monitoring)
            DEPLOY_MONITORING=true
            shift
            ;;
        --stack)
            STACK_NAME="$2"
            shift; shift
            ;;
        destroy)
            DESTROY=true
            shift
            ;;
        *)
            # Unknown option
            echo "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

echo "AWS Account: $AWS_ACCOUNT, Region: $AWS_REGION, Stack: $STACK_NAME"

# Change to the pulumi directory
cd pulumi

# Install dependencies
echo "Installing dependencies..."
npm install

# Build the TypeScript files
echo "Building TypeScript files..."
npm run build

# Create the stack if it doesn't exist
echo "Selecting/creating stack $STACK_NAME..."
pulumi stack select $STACK_NAME 2>/dev/null || pulumi stack init $STACK_NAME

# Set AWS region
echo "Setting AWS region to $AWS_REGION..."
pulumi config set aws:region $AWS_REGION

# Apply any additional configuration
if [ "$DEPLOY_MONITORING" = true ]; then
    echo "Enabling monitoring..."
    pulumi config set deployMonitoring true
fi

# Deploy or destroy the stack
if [ "$DESTROY" = true ]; then
    echo "Destroying stack $STACK_NAME..."
    pulumi destroy --yes
else
    echo "Deploying stack $STACK_NAME..."
    pulumi up --yes
fi
