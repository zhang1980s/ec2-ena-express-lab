import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface DedicatedHostArgs {
    stackName: string;
    vpcId: pulumi.Input<string>;
    instanceFamily: string;
    subnetCidr: string;
    routeTableId: pulumi.Input<string>;
}

export class DedicatedHost extends pulumi.ComponentResource {
    public readonly subnet: aws.ec2.Subnet;
    public readonly dedicatedHost: aws.ec2.DedicatedHost;
    public readonly securityGroup: aws.ec2.SecurityGroup;

    constructor(name: string, args: DedicatedHostArgs, opts?: pulumi.ComponentResourceOptions) {
        super("ec2-dedicated-host-lab:dedicatedhost:DedicatedHost", name, {}, opts);

        // Get availability zones
        const availabilityZones = pulumi.output(aws.getAvailabilityZones()).names;
        
        // Create a new subnet in the first AZ
        this.subnet = new aws.ec2.Subnet(`${name}-subnet`, {
            vpcId: args.vpcId,
            cidrBlock: args.subnetCidr,
            mapPublicIpOnLaunch: true,
            availabilityZone: availabilityZones[0],
            tags: {
                Name: `${args.stackName}-dedicated-host-subnet`,
            },
        }, { parent: this });
        
        // Associate the subnet with the route table
        const routeTableAssociation = new aws.ec2.RouteTableAssociation(`${name}-rt-assoc`, {
            subnetId: this.subnet.id,
            routeTableId: args.routeTableId,
        }, { parent: this });
        
        // Create security group
        this.securityGroup = new aws.ec2.SecurityGroup(`${name}-sg`, {
            vpcId: args.vpcId,
            description: "Security group for Dedicated Host",
            // Inbound rules
            ingress: [
                // Allow all traffic from the security group itself
                {
                    protocol: "-1",  // All protocols
                    fromPort: 0,
                    toPort: 0,
                    self: true,
                    description: "Allow all traffic from the security group itself",
                },
                // Allow SSH access from anywhere
                {
                    protocol: "tcp",
                    fromPort: 22,
                    toPort: 22,
                    cidrBlocks: ["0.0.0.0/0"],
                    description: "Allow SSH access from anywhere",
                },
            ],
            // Outbound rules - allow all traffic
            egress: [
                {
                    protocol: "-1",  // All protocols
                    fromPort: 0,
                    toPort: 0,
                    cidrBlocks: ["0.0.0.0/0"],
                    description: "Allow all outbound traffic",
                },
            ],
            tags: {
                Name: `${args.stackName}-dedicated-host-sg`,
            },
        }, { parent: this });
        
        // Create a dedicated host in the same AZ as the subnet
        this.dedicatedHost = new aws.ec2.DedicatedHost(`${name}-host`, {
            availabilityZone: this.subnet.availabilityZone,
            autoPlacement: "on",
            hostRecovery: "on",
            instanceType: `${args.instanceFamily}.24xlarge`, // Using the largest size for flexibility
            tags: {
                Name: `${args.stackName}-dedicated-host`,
            },
        }, { parent: this });

        this.registerOutputs({
            subnetId: this.subnet.id,
            dedicatedHostId: this.dedicatedHost.id,
            securityGroupId: this.securityGroup.id,
            availabilityZone: this.subnet.availabilityZone,
        });
    }
}
