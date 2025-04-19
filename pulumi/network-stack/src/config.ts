import * as pulumi from "@pulumi/pulumi";

// Get configuration
const config = new pulumi.Config();

export interface NetworkConfig {
    // General configuration
    stackName: string;
    
    // VPC configuration
    vpcCidr: string;
    subnetCidr: string;
}

// Default configuration values
const defaultConfig: NetworkConfig = {
    stackName: pulumi.getStack(),
    vpcCidr: "192.168.0.0/16",
    subnetCidr: "192.168.3.0/24",
};

// Load configuration from Pulumi config
export const networkConfig: NetworkConfig = {
    ...defaultConfig,
    vpcCidr: config.get("vpcCidr") ?? defaultConfig.vpcCidr,
    subnetCidr: config.get("subnetCidr") ?? defaultConfig.subnetCidr,
};
