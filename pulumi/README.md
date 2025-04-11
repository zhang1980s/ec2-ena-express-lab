# ENA vs ENA Express Latency Performance Testing with Pulumi

This project provides infrastructure for testing and comparing the performance of standard Elastic Network Adapter (ENA) and ENA Express on AWS EC2 instances using Pulumi.

## Key Advantages of Pulumi Implementation

1. **Direct ENA Express Support**: Pulumi directly supports enabling ENA Express on network interfaces, eliminating the need for post-deployment AWS CLI commands.

2. **Modular Architecture**: The infrastructure is organized into reusable components (networking, compute, monitoring) following Pulumi best practices.

3. **Type Safety**: Full TypeScript support with proper typing for better code quality and IDE assistance.

4. **Simplified Configuration**: Easy configuration management through Pulumi's built-in config system.

## Project Structure

```
pulumi/
├── Pulumi.yaml           # Project configuration
├── Pulumi.dev.yaml       # Dev stack configuration
├── package.json          # Node.js dependencies
├── tsconfig.json         # TypeScript configuration
├── pulumi-deploy-to.sh   # Deployment script
└── src/
    ├── index.ts          # Main entry point
    ├── config.ts         # Configuration handling
    ├── networking.ts     # VPC, subnet, security group
    ├── compute.ts        # EC2 instances, ENIs with ENA Express
    └── monitoring.ts     # Prometheus and Grafana monitoring
```

## Prerequisites

1. [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
2. [Node.js](https://nodejs.org/) (v14 or later)
3. [AWS CLI](https://aws.amazon.com/cli/) configured with appropriate credentials

## Setup

1. Install dependencies:

```bash
cd pulumi
npm install
```

2. Configure AWS credentials:

```bash
aws configure
# or
export AWS_ACCESS_KEY_ID=<your-access-key>
export AWS_SECRET_ACCESS_KEY=<your-secret-key>
```

## Deployment

### Using the Deployment Script

The `pulumi-deploy-to.sh` script simplifies deployment to specific AWS accounts and regions:

```bash
./pulumi-deploy-to.sh <account-id> <region> [options]
```

Options:
- `--with-monitoring`: Deploy the monitoring infrastructure (Prometheus and Grafana)
- `--stack <name>`: Use a specific stack name (default: dev)
- `destroy`: Destroy the stack instead of deploying it

Examples:
```bash
# Deploy to a specific account and region
./pulumi-deploy-to.sh 123456789012 us-east-1

# Deploy with monitoring
./pulumi-deploy-to.sh 123456789012 us-east-1 --with-monitoring

# Deploy to a production stack
./pulumi-deploy-to.sh 123456789012 us-east-1 --stack prod

# Destroy the stack
./pulumi-deploy-to.sh 123456789012 us-east-1 destroy
```

### Manual Deployment

You can also deploy manually using the Pulumi CLI:

```bash
# Select or create a stack
pulumi stack select dev
# or
pulumi stack init dev

# Set configuration
pulumi config set aws:region us-east-1
pulumi config set deployMonitoring true

# Deploy
pulumi up
```

## Infrastructure Components

### Networking

- VPC with CIDR block 192.168.0.0/16
- Public subnet with CIDR block 192.168.1.0/24
- Internet Gateway for public internet access
- Security group with rules for SSH access and internal communication

### Compute

- Cluster placement group for low-latency networking
- Two c6i.8xlarge EC2 instances running Amazon Linux 2023
- Primary ENIs with standard ENA configuration
- Secondary ENIs with ENA Express and ENA Express UDP enabled
- IAM role with Systems Manager access

### Monitoring (Optional)

- ECR repository for sockperf exporter
- ECS cluster with Fargate tasks
- Prometheus for metrics collection
- Grafana for visualization
- Application Load Balancer for Grafana access

## Testing Methodology

After deployment, you can run performance tests using the sockperf tool:

1. Connect to the EC2 instances using SSH or Systems Manager
2. Install sockperf using the provided scripts
3. Run tests comparing standard ENA and ENA Express performance
4. Analyze the results to quantify the performance improvements

## Cleanup

To avoid ongoing charges, destroy the infrastructure when testing is complete:

```bash
# Using the deployment script
./pulumi-deploy-to.sh <account-id> <region> destroy

# Or using Pulumi CLI directly
pulumi destroy
```

## Customization

You can customize the deployment by modifying the configuration in `Pulumi.dev.yaml` or by setting configuration values:

```bash
# Change the instance type
pulumi config set instanceType m5.xlarge

# Change the number of instances
pulumi config set instanceCount 3

# Change the VPC CIDR
pulumi config set vpcCidr 10.0.0.0/16
```
