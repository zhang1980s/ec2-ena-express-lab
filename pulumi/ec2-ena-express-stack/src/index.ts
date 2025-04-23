import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from "@pulumi/random";
import { computeConfig } from "./config";
import { Compute } from "./compute";

// Get references to the network stack outputs
const networkStack = new pulumi.StackReference(`${pulumi.getOrganization()}/ec2-ena-express-network/${computeConfig.networkStackName}`);
const vpcId = networkStack.getOutput("vpcId");
const subnetIds = networkStack.getOutput("subnetIds");
const securityGroupId = networkStack.getOutput("securityGroupId");

// Create compute resources
const compute = new Compute("compute", {
    stackName: computeConfig.stackName,
    subnetId: subnetIds.apply(ids => ids[0]), // Use the first subnet
    securityGroupId: securityGroupId,
    instanceType: computeConfig.instanceType,
    keyPairName: computeConfig.keyPairName,
    instanceCount: computeConfig.instanceCount,
});

// Since we're using user data scripts for software installation,
// we don't need the Lambda-based delay anymore.
// We'll just create a dependency marker to track the order of operations.
const dependencyMarker = new random.RandomString("dependency-marker", {
    length: 16,
    special: false,
}, { 
    dependsOn: compute.instances
});

// Define instance names
const instanceNames = ["sockperf-server", "sockperf-client"];

// Export outputs
export const placementGroupId = compute.placementGroup.id;
export const instanceIds = pulumi.output(compute.instances).apply(instances => 
    instances.map((instance, i) => ({ [instanceNames[i]]: instance.id }))
);
export const instancePublicIps = pulumi.output(compute.instances).apply(instances => {
    const result: Record<string, pulumi.Output<string>> = {};
    instances.forEach((instance, i) => {
        result[instanceNames[i]] = instance.publicIp;
    });
    return result;
});
export const instanceElasticIps = pulumi.output(compute.elasticIps).apply(eips => {
    const result: Record<string, pulumi.Output<string>> = {};
    eips.forEach((eip, i) => {
        result[instanceNames[i]] = eip.publicIp;
    });
    return result;
});
// Primary ENIs are no longer created separately, they're part of the instance
export const secondaryEniIds = pulumi.output(compute.secondaryEnis).apply(enis => 
    enis.map((eni, i) => ({ [`${instanceNames[i]}-secondary`]: eni.id }))
);
