import * as pulumi from "@pulumi/pulumi";

// Get configuration
const config = new pulumi.Config();

export interface DedicatedHostConfig {
    // General configuration
    stackName: string;
    
    // Dedicated Host configuration
    instanceFamily: string;
    availabilityZone: string;
    
    // Network configuration
    subnetCidr: string;
    
    // Network stack reference
    networkStackName: string;
}

// Default configuration values
const defaultConfig: DedicatedHostConfig = {
    stackName: pulumi.getStack(),
    instanceFamily: "c6i",
    availabilityZone: "us-east-1a", // This will be overridden by the actual AZ
    subnetCidr: "192.168.6.0/24",
    networkStackName: "dev",
};

// Load configuration from Pulumi config
export const dedicatedHostConfig: DedicatedHostConfig = {
    ...defaultConfig,
    instanceFamily: config.get("instanceFamily") ?? defaultConfig.instanceFamily,
    availabilityZone: config.get("availabilityZone") ?? defaultConfig.availabilityZone,
    subnetCidr: config.get("subnetCidr") ?? defaultConfig.subnetCidr,
    networkStackName: config.get("networkStackName") ?? defaultConfig.networkStackName,
};
