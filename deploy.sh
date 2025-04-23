#!/bin/bash
# Script to deploy the ENA Express Lab Pulumi stacks to a specific AWS account and region

# Function to display usage information
show_usage() {
    echo 1>&2 "Usage: ./deploy.sh <account-id> <region> [options]"
    echo 1>&2 ""
    echo 1>&2 "Options:"
    echo 1>&2 "  --stack <name>       Use a specific stack name (default: dev)"
    echo 1>&2 "  --network            Deploy only the network stack"
    echo 1>&2 "  --compute-ena-express Deploy only the compute stack"
    echo 1>&2 "  --monitoring         Deploy only the monitoring stack"
    echo 1>&2 "  --all                Deploy all stacks (default)"
    echo 1>&2 "  destroy              Destroy the specified stack(s) instead of deploying"
    echo 1>&2 ""
    echo 1>&2 "Examples:"
    echo 1>&2 "  ./deploy.sh 123456789012 us-east-1                             # Deploy all stacks"
    echo 1>&2 "  ./deploy.sh 123456789012 us-east-1 --network                   # Deploy only network stack"
    echo 1>&2 "  ./deploy.sh 123456789012 us-east-1 --compute-ena-express       # Deploy only compute stack"
    echo 1>&2 "  ./deploy.sh 123456789012 us-east-1 --monitoring                # Deploy only monitoring stack"
    echo 1>&2 "  ./deploy.sh 123456789012 us-east-1 --all destroy               # Destroy all stacks"
    echo 1>&2 "  ./deploy.sh 123456789012 us-east-1 --network destroy           # Destroy network stack"
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
DEPLOY_NETWORK=false
DEPLOY_COMPUTE=false
DEPLOY_MONITORING=false
DEPLOY_ALL=true
DESTROY=false

# Process options
while [[ $# -gt 0 ]]; do
    case "$1" in
        --stack)
            STACK_NAME="$2"
            shift; shift
            ;;
        --network)
            DEPLOY_NETWORK=true
            DEPLOY_ALL=false
            shift
            ;;
        --compute-ena-express)
            DEPLOY_COMPUTE=true
            DEPLOY_ALL=false
            shift
            ;;
        --monitoring)
            DEPLOY_MONITORING=true
            DEPLOY_ALL=false
            shift
            ;;
        --all)
            DEPLOY_ALL=true
            DEPLOY_NETWORK=false
            DEPLOY_COMPUTE=false
            DEPLOY_MONITORING=false
            shift
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

# Function to deploy or destroy a stack
deploy_or_destroy_stack() {
    local stack_dir=$1
    local stack_name=$2
    
    echo "Working with stack: $stack_name"
    
    # Change to the stack directory
    cd $stack_dir
    
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
    
    # Set stack references if needed
    if [[ "$stack_name" == "ec2-ena-express-compute" ]]; then
        echo "Setting network stack reference..."
        pulumi config set networkStackName $STACK_NAME
        # Get the organization name
        ORG_NAME=$(pulumi whoami)
        echo "Organization name: $ORG_NAME"
    elif [[ "$stack_name" == "ec2-ena-express-monitoring" ]]; then
        echo "Setting network and compute stack references..."
        pulumi config set networkStackName $STACK_NAME
        pulumi config set computeStackName $STACK_NAME
        # Get the organization name
        ORG_NAME=$(pulumi whoami)
        echo "Organization name: $ORG_NAME"
    fi
    
    # Deploy or destroy the stack
    if [ "$DESTROY" = true ]; then
        echo "Destroying stack $stack_name..."
        pulumi destroy --yes
    else
        echo "Deploying stack $stack_name..."
        pulumi up --yes
    fi
    
    # Return to the parent directory
    cd ../..
}

# Deploy or destroy stacks based on options
if [ "$DEPLOY_ALL" = true ] || [ "$DEPLOY_NETWORK" = true ]; then
    deploy_or_destroy_stack "pulumi/network-stack" "ec2-ena-express-network"
fi

if [ "$DEPLOY_ALL" = true ] || [ "$DEPLOY_COMPUTE" = true ]; then
    deploy_or_destroy_stack "pulumi/ec2-ena-express-stack" "ec2-ena-express-compute"
fi

if [ "$DEPLOY_ALL" = true ] || [ "$DEPLOY_MONITORING" = true ]; then
    deploy_or_destroy_stack "pulumi/monitoring-stack" "ec2-ena-express-monitoring"
fi

echo "Operation completed successfully!"
