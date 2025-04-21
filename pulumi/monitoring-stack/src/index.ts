import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { monitoringConfig } from "./config";
import { Monitoring } from "./monitoring";

// Get references to the network stack outputs
const networkStack = new pulumi.StackReference(`${pulumi.getOrganization()}/ec2-ena-express-network/${monitoringConfig.networkStackName}`);
const vpcId = networkStack.getOutput("vpcId");
const subnetIds = networkStack.getOutput("subnetIds");

// Get references to the compute stack outputs
const computeStack = new pulumi.StackReference(`${pulumi.getOrganization()}/ec2-ena-express-compute/${monitoringConfig.computeStackName}`);
const instanceElasticIps = computeStack.getOutput("instanceElasticIps");

// Create monitoring resources with Elastic IPs for testInstanceIps
const monitoring = new Monitoring("monitoring", {
    stackName: monitoringConfig.stackName,
    vpcId: vpcId,
    subnetIds: [subnetIds.apply(ids => ids[0])], // Use the first subnet
    grafanaPassword: monitoringConfig.grafanaPassword,
    testInstanceIps: instanceElasticIps.apply(ips => [ips["sockperf-server"], ips["sockperf-client"]]),
});

// Log the instance IPs for reference
instanceElasticIps.apply(ips => {
    console.log("Instance Elastic IPs for monitoring:", JSON.stringify(ips));
    return ips;
});

// Export outputs
export const exporterRepositoryUrl = monitoring.exporterRepository.url;
export const grafanaUrl = monitoring.grafanaUrl;
