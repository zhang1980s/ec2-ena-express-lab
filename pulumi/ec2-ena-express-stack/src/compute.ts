import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from "fs";
import * as path from "path";

export interface ComputeArgs {
    stackName: string;
    subnetId: pulumi.Input<string>;
    securityGroupId: pulumi.Input<string>;
    instanceType: string;
    keyPairName: string;
    instanceCount: number;
    placementGroupStrategy: string;
}

export class Compute extends pulumi.ComponentResource {
    public readonly placementGroup: aws.ec2.PlacementGroup;
    public readonly instances: aws.ec2.Instance[];
    public readonly secondaryEnis: aws.ec2.NetworkInterface[];
    public readonly instanceRole: aws.iam.Role;
    public readonly elasticIps: aws.ec2.Eip[];

    constructor(name: string, args: ComputeArgs, opts?: pulumi.ComponentResourceOptions) {
        super("ec2-ena-express-lab:compute:Compute", name, {}, opts);

        // Create placement group
        this.placementGroup = new aws.ec2.PlacementGroup(`${name}-pg`, {
            strategy: args.placementGroupStrategy,
            tags: {
                Name: `${args.stackName}-placement-group`,
            },
        }, { parent: this });

        // Create the IAM role for EC2 instances
        this.instanceRole = new aws.iam.Role(`${name}-role`, {
            assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
                Service: "ec2.amazonaws.com",
            }),
            tags: {
                Name: `${args.stackName}-ec2-role`,
            },
            // Force replacement instead of update to ensure clean deletion
            forceDetachPolicies: true,
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
                    values: ["al2023-ami-2023*-x86_64"],
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
        this.secondaryEnis = [];
        this.elasticIps = [];

        // Define instance names and IP addresses as per README.md
        const instanceConfigs = [
            {
                name: "sockperf-server",
                hostname: "sockperf-server.zzhe.xyz",
                primaryIp: "192.168.3.10",
                secondaryIp: "192.168.3.11",
                isServer: true
            },
            {
                name: "sockperf-client",
                hostname: "sockperf-client.zzhe.xyz",
                primaryIp: "192.168.3.20",
                secondaryIp: "192.168.3.21",
                isServer: false
            }
        ];

        // Create instances based on the configuration
        for (let i = 0; i < instanceConfigs.length; i++) {
            const config = instanceConfigs[i];
            
            // Create an Elastic IP for this instance
            const eip = new aws.ec2.Eip(`${name}-eip-${i+1}`, {
                domain: "vpc",
                tags: {
                    Name: `${args.stackName}-${config.name}-eip`,
                },
            }, { parent: this });
            this.elasticIps.push(eip);
            
            // We'll associate the Elastic IP with the instance after it's created

            // Create the secondary network interface with fixed IP
            const secondaryEni = new aws.ec2.NetworkInterface(`${name}-secondary-eni-${i+1}`, {
                subnetId: args.subnetId,
                securityGroups: [args.securityGroupId],
                privateIps: [config.secondaryIp],
                description: `Secondary ENI with ENA Express for ${config.name}`,
                tags: {
                    Name: `${args.stackName}-${config.name}-secondary-eni`,
                },
            }, { parent: this });
            this.secondaryEnis.push(secondaryEni);

            // Read the base script and the specific instance script
            // Use path.resolve to go up one directory from __dirname (bin) to src
            const srcDir = path.resolve(__dirname, '..');
            const baseScriptPath = path.join(srcDir, 'src', 'user-data', 'base.sh');
            const baseScript = fs.readFileSync(baseScriptPath, 'utf8');
            
            // Determine which specific script to use based on the instance type
            const specificScriptName = config.isServer ? 'server.sh' : 'client.sh';
            const specificScriptPath = path.join(srcDir, 'src', 'user-data', specificScriptName);
            const specificScript = fs.readFileSync(specificScriptPath, 'utf8');
            
            // Create a combined script that first writes the base script to a file and then executes the specific script
            const userData = `#!/bin/bash

# Write the base script to a temporary file
cat > /tmp/base.sh << 'EOL'
${baseScript}
EOL

# Make the base script executable
chmod +x /tmp/base.sh

# Execute the specific script
${specificScript}
`;

            // Create EC2 instance with proper dependencies to ensure deletion order
            const instance = new aws.ec2.Instance(`${name}-${config.name}`, {
                ami: ami.id,
                instanceType: args.instanceType,
                placementGroup: this.placementGroup.id,
                keyName: args.keyPairName,
                // Use subnet_id and security_groups instead of networkInterfaces
                // This allows the instance to be replaced without the "network interface in use" error
                subnetId: args.subnetId,
                vpcSecurityGroupIds: [args.securityGroupId],
                privateIp: config.primaryIp,
                userData: Buffer.from(userData).toString('base64'),
                iamInstanceProfile: instanceProfile.name,
                cpuOptions: {
                    coreCount: 32,      // Explicitly specify the number of cores
                    threadsPerCore: 1,  // Set 1 thread per core (disable hyperthreading)
                },
                tags: {
                    Name: `${args.stackName}-${config.name}`,
                },
            }, { 
                parent: this,
                dependsOn: [ssmPolicyAttachment], // Ensure policy is attached before instance is created
            });
            this.instances.push(instance);

            // Attach the secondary ENI to the instance
            const secondaryEniAttachment = new aws.ec2.NetworkInterfaceAttachment(`${name}-secondary-eni-attachment-${i+1}`, {
                instanceId: instance.id,
                networkInterfaceId: secondaryEni.id,
                deviceIndex: 1,
            }, { parent: this });
            
            // Enable ENA Express on the secondary ENI
            const enableEnaExpressCommand = new aws.ec2.Tag(`${name}-ena-express-tag-${i+1}`, {
                resourceId: secondaryEni.id,
                key: "EnableEnaExpress",
                value: "true",
            }, { 
                parent: this,
                dependsOn: [secondaryEniAttachment],
            });
            
            // Associate the Elastic IP with the instance's primary network interface
            // When an instance has multiple network interfaces, we must specify which one to associate the EIP with
            const eipAssociation = new aws.ec2.EipAssociation(`${name}-eip-assoc-${i+1}`, {
                networkInterfaceId: instance.primaryNetworkInterfaceId,
                allocationId: eip.id,
            }, { 
                parent: this,
                dependsOn: [instance],
            });
        }

        // Create an output that displays the instance names and their Elastic IPs
        const instanceElasticIps = pulumi.all(instanceConfigs.map((config, i) => ({
            name: config.name,
            elasticIp: this.elasticIps[i].publicIp
        })));
        
        // Log the instance names and Elastic IPs when the deployment is complete
        instanceElasticIps.apply(ips => {
            console.log("\n=== EC2 Instances Elastic IPs ===");
            ips.forEach(ip => {
                console.log(`${ip.name}: ${ip.elasticIp}`);
            });
            console.log("===============================\n");
            return ips;
        });

        this.registerOutputs({
            placementGroupId: this.placementGroup.id,
            instanceIds: pulumi.output(this.instances).apply(instances => instances.map(instance => instance.id)),
            secondaryEniIds: pulumi.output(this.secondaryEnis).apply(enis => enis.map(eni => eni.id)),
            instancePublicIps: pulumi.output(this.instances).apply(instances => instances.map((instance, i) => ({ 
                name: instanceConfigs[i].name,
                publicIp: instance.publicIp 
            }))),
            instanceElasticIps: pulumi.output(this.elasticIps).apply(eips => eips.map((eip, i) => ({
                name: instanceConfigs[i].name,
                elasticIp: eip.publicIp
            }))),
        });
    }
}
