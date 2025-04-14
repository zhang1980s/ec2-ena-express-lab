import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface ComputeArgs {
    stackName: string;
    subnetId: pulumi.Input<string>;
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

        // First create the IAM role without any dependencies
        const tempRole = new aws.iam.Role(`${name}-role-temp`, {
            assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
                Service: "ec2.amazonaws.com",
            }),
            tags: {
                Name: `${args.stackName}-ec2-role`,
            },
        }, { parent: this });

        // Attach SSM managed policy
        const ssmPolicyAttachment = new aws.iam.RolePolicyAttachment(`${name}-ssm-policy`, {
            role: tempRole.name,
            policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
        }, { parent: this });

        // Now create the final role with dependency on the policy attachment
        // This ensures the policy is detached before the role is deleted
        this.instanceRole = new aws.iam.Role(`${name}-role`, {
            assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
                Service: "ec2.amazonaws.com",
            }),
            tags: {
                Name: `${args.stackName}-ec2-role`,
            },
        }, { 
            parent: this,
            dependsOn: [ssmPolicyAttachment]
        });

        // Update the policy attachment to use the final role
        const finalPolicyAttachment = new aws.iam.RolePolicyAttachment(`${name}-final-ssm-policy`, {
            role: this.instanceRole.name,
            policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
        }, { 
            parent: this,
            deleteBeforeReplace: true  // Ensure this is deleted before the role is replaced
        });

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

        // Define instance names and IP addresses
        const instanceConfigs = [
            {
                name: "sockperf-server",
                hostname: "sockperf-server.zzhe.xyz",
                primaryIp: "192.168.1.1",
                secondaryIp: "192.168.1.11",
                isServer: true
            },
            {
                name: "sockperf-client",
                hostname: "sockperf-client.zzhe.xyz",
                primaryIp: "192.168.1.2",
                secondaryIp: "192.168.1.22",
                isServer: false
            }
        ];

        // Create sockperf installation script (from install-test-tools.sh)
        const sockperfInstallScript = `#!/bin/bash
# Script to install sockperf for network performance testing on Amazon Linux 2023
# For ENA vs ENA Express latency and bandwidth performance testing

set -e

echo "Updating system packages..."
dnf update -y

echo "Installing dependencies for sockperf..."
dnf groupinstall -y "Development Tools"
dnf install -y wget unzip ethtool htop

echo "Downloading and installing sockperf..."
wget https://github.com/Mellanox/sockperf/archive/refs/tags/3.10.zip
unzip 3.10.zip
cd sockperf-3.10
./autogen.sh
./configure
make
make install

echo "Testing sockperf installation..."
echo "sockperf version: $(sockperf --version)"

echo "Installation complete!"
`;

        // Create instances based on the configuration
        for (let i = 0; i < instanceConfigs.length; i++) {
            const config = instanceConfigs[i];
            
            // Create the primary network interface with fixed IP
            const primaryEni = new aws.ec2.NetworkInterface(`${name}-primary-eni-${i+1}`, {
                subnetId: args.subnetId,
                securityGroups: [args.securityGroupId],
                privateIps: [config.primaryIp],
                description: `Primary ENI for ${config.name}`,
                tags: {
                    Name: `${args.stackName}-${config.name}-primary-eni`,
                },
            }, { parent: this });
            this.primaryEnis.push(primaryEni);

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

            // Create user data script to set hostname and install sockperf
            let userData = pulumi.interpolate`#!/bin/bash
# Set hostname
hostnamectl set-hostname ${config.hostname}
echo "127.0.0.1 ${config.hostname}" >> /etc/hosts

# Install sockperf and dependencies
${sockperfInstallScript}

# Additional server-specific configuration
${config.isServer ? `
# Start sockperf server on boot
cat > /etc/systemd/system/sockperf-server.service << 'EOF'
[Unit]
Description=SockPerf Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/sockperf server -i 0.0.0.0 --tcp -p 11111
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the service
systemctl enable sockperf-server
systemctl start sockperf-server

# Start UDP server as well
cat > /etc/systemd/system/sockperf-udp-server.service << 'EOF'
[Unit]
Description=SockPerf UDP Server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/sockperf server -i 0.0.0.0 --udp -p 11112
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start the UDP service
systemctl enable sockperf-udp-server
systemctl start sockperf-udp-server
` : ''}
`;

            // Create EC2 instance
            const instance = new aws.ec2.Instance(`${name}-${config.name}`, {
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
                userData: userData.apply(ud => Buffer.from(ud).toString('base64')),
                iamInstanceProfile: instanceProfile.name,
                tags: {
                    Name: `${args.stackName}-${config.name}`,
                },
            }, { parent: this });
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
