#!/usr/bin/env bash
# Script to deploy the ENA Express Lab CDK stack to a specific AWS account and region
# Based on the AWS CDK environment guide: https://docs.aws.amazon.com/cdk/v2/guide/environments.html

# Function to display usage information
show_usage() {
    echo 1>&2 "Usage: ./cdk-deploy-to.sh <account-id> <region> [options] [additional-cdk-options]"
    echo 1>&2 ""
    echo 1>&2 "Options:"
    echo 1>&2 "  --with-monitoring    Deploy the monitoring stack along with the main stack"
    echo 1>&2 "  --monitoring-only    Deploy only the monitoring stack"
    echo 1>&2 ""
    echo 1>&2 "Examples:"
    echo 1>&2 "  ./cdk-deploy-to.sh 123456789012 us-east-1"
    echo 1>&2 "  ./cdk-deploy-to.sh 123456789012 us-east-1 --with-monitoring"
    echo 1>&2 "  ./cdk-deploy-to.sh 123456789012 us-east-1 --monitoring-only"
    echo 1>&2 "  ./cdk-deploy-to.sh 123456789012 us-east-1 --context stackName=MyCustomStack"
    echo 1>&2 "  ./cdk-deploy-to.sh 123456789012 us-east-1 --require-approval never"
    echo 1>&2 ""
    echo 1>&2 "Additional arguments are passed through to 'cdk deploy'."
}

# Check if at least 2 arguments are provided (account and region)
if [[ $# -lt 2 ]]; then
    echo 1>&2 "Error: Insufficient arguments."
    show_usage
    exit 1
fi

# Set environment variables for CDK deployment
export CDK_DEPLOY_ACCOUNT=$1
export CDK_DEPLOY_REGION=$2

# Shift the first two arguments (account and region)
shift; shift

# Initialize variables
DEPLOY_MAIN=true
DEPLOY_MONITORING=false
CDK_ARGS=()

# Process options
while [[ $# -gt 0 ]]; do
    case "$1" in
        --with-monitoring)
            DEPLOY_MONITORING=true
            shift
            ;;
        --monitoring-only)
            DEPLOY_MAIN=false
            DEPLOY_MONITORING=true
            shift
            ;;
        *)
            # Add all other arguments to CDK_ARGS array
            CDK_ARGS+=("$1")
            shift
            ;;
    esac
done

# Determine which stacks to deploy
if [ "$DEPLOY_MAIN" = true ] && [ "$DEPLOY_MONITORING" = true ]; then
    STACKS="Ec2EnaExpressLabStack MonitoringStack"
    CONTEXT_ARGS="--context deployMonitoring=true"
elif [ "$DEPLOY_MAIN" = true ]; then
    STACKS="Ec2EnaExpressLabStack"
    CONTEXT_ARGS=""
elif [ "$DEPLOY_MONITORING" = true ]; then
    STACKS="MonitoringStack"
    CONTEXT_ARGS="--context deployMonitoring=true"
else
    echo "Error: No stacks selected for deployment."
    show_usage
    exit 1
fi

echo "Deploying to account: $CDK_DEPLOY_ACCOUNT, region: $CDK_DEPLOY_REGION"
echo "Stacks to deploy: $STACKS"

# Execute CDK deploy with all arguments
npx cdk deploy $STACKS $CONTEXT_ARGS "${CDK_ARGS[@]}"
exit $?
