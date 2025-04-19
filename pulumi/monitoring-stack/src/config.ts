import * as pulumi from "@pulumi/pulumi";

// Get configuration
const config = new pulumi.Config();

export interface MonitoringConfig {
    // General configuration
    stackName: string;
    
    // Monitoring configuration
    grafanaPassword: string;
    
    // Stack references
    networkStackName: string;
    computeStackName: string;
}

// Default configuration values
const defaultConfig: MonitoringConfig = {
    stackName: pulumi.getStack(),
    grafanaPassword: "admin",
    networkStackName: "dev",
    computeStackName: "dev",
};

// Load configuration from Pulumi config
export const monitoringConfig: MonitoringConfig = {
    ...defaultConfig,
    grafanaPassword: config.getSecret("grafanaPassword")?.toString() ?? defaultConfig.grafanaPassword,
    networkStackName: config.get("networkStackName") ?? defaultConfig.networkStackName,
    computeStackName: config.get("computeStackName") ?? defaultConfig.computeStackName,
};
