#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Ec2EnaExpressLabStack } from '../lib/ec2-ena-express-lab-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

// Get environment configuration
const env = {
  account: process.env.CDK_DEPLOY_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEPLOY_REGION || process.env.CDK_DEFAULT_REGION
};

// Get stack names from context or use defaults
const mainStackName = app.node.tryGetContext('stackName') || 'Ec2EnaExpressLabStack';
const monitoringStackName = app.node.tryGetContext('monitoringStackName') || 'MonitoringStack';

// Check if monitoring should be deployed
const deployMonitoring = app.node.tryGetContext('deployMonitoring') === 'true';

// Create the main infrastructure stack
const mainStack = new Ec2EnaExpressLabStack(app, 'Ec2EnaExpressLabStack', {
  stackName: mainStackName,
  env: env,
  description: 'Infrastructure for ENA vs ENA Express latency performance testing',
});

// Create the monitoring stack if requested
if (deployMonitoring) {
  new MonitoringStack(app, 'MonitoringStack', {
    stackName: monitoringStackName,
    env: env,
    description: 'Monitoring infrastructure for ENA vs ENA Express performance testing',
    // You can pass the VPC and instances from the main stack if needed
    // vpc: mainStack.vpc,
    // testInstances: mainStack.instances,
  });
}
