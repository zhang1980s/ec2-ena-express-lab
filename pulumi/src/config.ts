import * as pulumi from "@pulumi/pulumi";

// Get configuration
const config = new pulumi.Config();

export interface EnaExpressLabConfig {
    // General configuration
    stackName: string;
    deployMonitoring: boolean;
    
    // VPC configuration
    vpcCidr: string;
    subnetCidr: string;
    
    // EC2 configuration
    instanceType: string;
    keyPairName: string;
    instanceCount: number;
    
    // Monitoring configuration
    grafanaPassword: string;
}

// Default configuration values
const defaultConfig: EnaExpressLabConfig = {
    stackName: pulumi.getStack(),
    deployMonitoring: false,
    vpcCidr: "192.168.0.0/16",
    subnetCidr: "192.168.1.0/24",
    instanceType: "c6i.8xlarge",
    keyPairName: "keypair-sandbox0-sin-mymac.pem",
    instanceCount: 2,
    grafanaPassword: "admin",
};

// Load configuration from Pulumi config
export const enaExpressLabConfig: EnaExpressLabConfig = {
    ...defaultConfig,
    deployMonitoring: config.getBoolean("deployMonitoring") ?? defaultConfig.deployMonitoring,
    vpcCidr: config.get("vpcCidr") ?? defaultConfig.vpcCidr,
    subnetCidr: config.get("subnetCidr") ?? defaultConfig.subnetCidr,
    instanceType: config.get("instanceType") ?? defaultConfig.instanceType,
    keyPairName: config.get("keyPairName") ?? defaultConfig.keyPairName,
    instanceCount: config.getNumber("instanceCount") ?? defaultConfig.instanceCount,
    grafanaPassword: config.getSecret("grafanaPassword")?.toString() ?? defaultConfig.grafanaPassword,
};
