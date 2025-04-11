import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface ComputeArgs {
    stackName: string;
    subnetId: pulumi.Input<string>;
    secondarySubnetId: pulumi.Input<string>; // Added secondary subnet ID
    securityGroupId: pulumi.Input<string>;
    instanceType: string;
    keyPairName: string;
    instanceCount: number;
}

export class Compute extends pulumi.ComponentResource {
    public readonly placementGroup: aws.ec2.PlacementGroup;
    public readonly instances: aws.ec2.Instance[];
    public readonly primaryEnis: aws.ec2.NetworkInterface[];
    public readonly secondaryEnis: aws.ec2.NetworkInterface[];
    public readonly instanceRole: aws.iam.Role;

    constructor(name: string, args: ComputeArgs, opts?: pulumi.ComponentResourceOptions) {
        super("ec2-ena-express-lab:compute:Compute", name, {}, opts);

        // Create placement group
        this.placementGroup = new aws.ec2.PlacementGroup(`${name}-pg`, {
            strategy: "cluster",
            tags: {
                Name: `${args.stackName}-placement-group`,
            },
        }, { parent: this });

        // Create IAM role for SSM access
        this.instanceRole = new aws.iam.Role(`${name}-role`, {
            assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
                Service: "ec2.amazonaws.com",
            }),
            tags: {
                Name: `${args.stackName}-ec2-role`,
            },
        }, { parent: this });

        // Attach SSM managed policy
        const ssmPolicyAttachment = new aws.iam.RolePolicyAttachment(`${name}-ssm-policy`, {
            role: this.instanceRole.name,
            policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
        }, { parent: this });

        // Create instance profile
        const instanceProfile = new aws.iam.InstanceProfile(`${name}-instance-profile`, {
            role: this.instanceRole.name,
        }, { parent: this });

        // Get the latest Amazon Linux 2023 AMI
        const ami = pulumi.output(aws.ec2.getAmi({
            mostRecent: true,
            owners: ["amazon"],
            filters: [
                {
                    name: "name",
                    values: ["al2023-ami-*-x86_64"],
                },
                {
                    name: "root-device-type",
                    values: ["ebs"],
                },
                {
                    name: "virtualization-type",
                    values: ["hvm"],
                },
            ],
        }));

        // Create instances and ENIs
        this.instances = [];
        this.primaryEnis = [];
        this.secondaryEnis = [];

        for (let i = 1; i <= args.instanceCount; i++) {
            // Create the primary network interface
            const primaryEni = new aws.ec2.NetworkInterface(`${name}-primary-eni-${i}`, {
                subnetId: args.subnetId,
                securityGroups: [args.securityGroupId],
                description: `Primary ENI for instance ${i}`,
                tags: {
                    Name: `${args.stackName}-primary-eni-${i}`,
                },
            }, { parent: this });
            this.primaryEnis.push(primaryEni);

            // Create the secondary network interface in the secondary subnet
            const secondaryEni = new aws.ec2.NetworkInterface(`${name}-secondary-eni-${i}`, {
                subnetId: args.secondarySubnetId,
                securityGroups: [args.securityGroupId],
                description: `Secondary ENI with ENA Express for instance ${i} (in secondary subnet)`,
                tags: {
                    Name: `${args.stackName}-secondary-eni-${i}`,
                },
            }, { parent: this });
            this.secondaryEnis.push(secondaryEni);

            // Create EC2 instance
            const instance = new aws.ec2.Instance(`${name}-instance-${i}`, {
                ami: ami.id,
                instanceType: args.instanceType,
                placementGroup: this.placementGroup.id,
                keyName: args.keyPairName,
                networkInterfaces: [
                    {
                        networkInterfaceId: primaryEni.id,
                        deviceIndex: 0,
                    },
                ],
                iamInstanceProfile: instanceProfile.name,
                tags: {
                    Name: `${args.stackName}-instance-${i}`,
                },
            }, { parent: this });
            this.instances.push(instance);

            // Attach the secondary ENI to the instance
            const secondaryEniAttachment = new aws.ec2.NetworkInterfaceAttachment(`${name}-secondary-eni-attachment-${i}`, {
                instanceId: instance.id,
                networkInterfaceId: secondaryEni.id,
                deviceIndex: 1,
            }, { parent: this });
            
            // Enable ENA Express on the secondary ENI using AWS CLI
            // We'll use a custom command to enable ENA Express after deployment
            const enableEnaExpressCommand = new aws.ec2.Tag(`${name}-ena-express-tag-${i}`, {
                resourceId: secondaryEni.id,
                key: "EnableEnaExpress",
                value: "true",
            }, { 
                parent: this,
                dependsOn: [secondaryEniAttachment],
            });
        }

        this.registerOutputs({
            placementGroupId: this.placementGroup.id,
            instanceIds: pulumi.output(this.instances).apply(instances => instances.map(instance => instance.id)),
            primaryEniIds: pulumi.output(this.primaryEnis).apply(enis => enis.map(eni => eni.id)),
            secondaryEniIds: pulumi.output(this.secondaryEnis).apply(enis => enis.map(eni => eni.id)),
            instancePublicIps: pulumi.output(this.instances).apply(instances => instances.map(instance => instance.publicIp)),
        });
    }
}
