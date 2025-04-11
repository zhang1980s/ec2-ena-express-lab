import * as pulumi from "@pulumi/pulumi";
import { enaExpressLabConfig } from "./config";
import { Networking } from "./networking";
import { Compute } from "./compute";
import { Monitoring } from "./monitoring";

// Create networking resources
const networking = new Networking("networking", {
    vpcCidr: enaExpressLabConfig.vpcCidr,
    subnetCidr: enaExpressLabConfig.subnetCidr,
    stackName: enaExpressLabConfig.stackName,
});

// Create compute resources
const compute = new Compute("compute", {
    stackName: enaExpressLabConfig.stackName,
    subnetId: networking.subnets[0].id,
    secondarySubnetId: networking.secondarySubnet.id,
    securityGroupId: networking.securityGroup.id,
    instanceType: enaExpressLabConfig.instanceType,
    keyPairName: enaExpressLabConfig.keyPairName,
    instanceCount: enaExpressLabConfig.instanceCount,
});

// Create monitoring resources if enabled
let monitoring: Monitoring | undefined;
if (enaExpressLabConfig.deployMonitoring) {
    monitoring = new Monitoring("monitoring", {
        stackName: enaExpressLabConfig.stackName,
        vpcId: networking.vpc.id,
        subnetIds: networking.subnets.map(subnet => subnet.id),
        grafanaPassword: enaExpressLabConfig.grafanaPassword,
        testInstanceIps: compute.instances.map(instance => instance.publicIp),
    });
}

// Export outputs
export const vpcId = networking.vpc.id;
export const subnetIds = pulumi.output(networking.subnets).apply(subnets => subnets.map(subnet => subnet.id));
export const secondarySubnetId = networking.secondarySubnet.id;
export const securityGroupId = networking.securityGroup.id;
export const placementGroupId = compute.placementGroup.id;
export const instanceIds = pulumi.output(compute.instances).apply(instances => 
    instances.map((instance, i) => ({ [`instance${i+1}`]: instance.id }))
);
export const instancePublicIps = pulumi.output(compute.instances).apply(instances => 
    instances.map((instance, i) => ({ [`instance${i+1}`]: instance.publicIp }))
);
export const primaryEniIds = pulumi.output(compute.primaryEnis).apply(enis => 
    enis.map((eni, i) => ({ [`primaryEni${i+1}`]: eni.id }))
);
export const secondaryEniIds = pulumi.output(compute.secondaryEnis).apply(enis => 
    enis.map((eni, i) => ({ [`secondaryEni${i+1}`]: eni.id }))
);

// Export monitoring outputs if enabled
export const exporterRepositoryUrl = monitoring ? monitoring.exporterRepository.url : undefined;
export const grafanaUrl = monitoring ? monitoring.grafanaUrl : undefined;
