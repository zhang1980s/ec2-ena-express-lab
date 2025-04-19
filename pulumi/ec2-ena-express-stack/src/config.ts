import * as pulumi from "@pulumi/pulumi";

// Get configuration
const config = new pulumi.Config();

export interface ComputeConfig {
    // General configuration
    stackName: string;
    
    // EC2 configuration
    instanceType: string;
    keyPairName: string;
    instanceCount: number;
    
    // Network stack reference
    networkStackName: string;
}

// Default configuration values
const defaultConfig: ComputeConfig = {
    stackName: pulumi.getStack(),
    instanceType: "c7i.16xlarge",
    keyPairName: "keypair-sandbox0-iad",
    instanceCount: 2,
    networkStackName: "dev",
};

// Load configuration from Pulumi config
export const computeConfig: ComputeConfig = {
    ...defaultConfig,
    instanceType: config.get("instanceType") ?? defaultConfig.instanceType,
    keyPairName: config.get("keyPairName") ?? defaultConfig.keyPairName,
    instanceCount: config.getNumber("instanceCount") ?? defaultConfig.instanceCount,
    networkStackName: config.get("networkStackName") ?? defaultConfig.networkStackName,
};
