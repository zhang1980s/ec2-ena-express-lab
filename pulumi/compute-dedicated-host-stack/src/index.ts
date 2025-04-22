import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { dedicatedHostConfig } from "./config";
import { DedicatedHost } from "./dedicated-host";

// Get references to the network stack outputs
const networkStack = new pulumi.StackReference(`${pulumi.getOrganization()}/ec2-ena-express-network/${dedicatedHostConfig.networkStackName}`);
const vpcId = networkStack.getOutput("vpcId");
const routeTableId = networkStack.getOutput("routeTableId");

// Create dedicated host resources
const dedicatedHost = new DedicatedHost("dedicated-host", {
    stackName: dedicatedHostConfig.stackName,
    vpcId: vpcId,
    instanceFamily: dedicatedHostConfig.instanceFamily,
    subnetCidr: dedicatedHostConfig.subnetCidr,
    routeTableId: routeTableId,
});

// Export outputs
export const subnetId = dedicatedHost.subnet.id;
export const dedicatedHostId = dedicatedHost.dedicatedHost.id;
export const securityGroupId = dedicatedHost.securityGroup.id;
export const availabilityZone = dedicatedHost.subnet.availabilityZone;
