import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { networkConfig } from "./config";
import { Networking } from "./networking";

// Create networking resources
const networking = new Networking("networking", {
    vpcCidr: networkConfig.vpcCidr,
    subnetCidr: networkConfig.subnetCidr,
    stackName: networkConfig.stackName,
});

// Export outputs that will be referenced by other stacks
export const vpcId = networking.vpc.id;
export const subnetIds = pulumi.output(networking.subnets).apply(subnets => subnets.map(subnet => subnet.id));
export const securityGroupId = networking.securityGroup.id;
