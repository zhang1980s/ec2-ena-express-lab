import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as fs from "fs";
import * as path from "path";

export interface DedicatedHostArgs {
    stackName: string;
    vpcId: pulumi.Input<string>;
    instanceFamily: string;
    instanceType: string;
    instanceCount: number;
    keyPairName: string;
    subnetCidr: string;
    routeTableId: pulumi.Input<string>;
}

export class DedicatedHost extends pulumi.ComponentResource {
    public readonly subnet: aws.ec2.Subnet;
    public readonly dedicatedHost: aws.ec2.DedicatedHost;
    public readonly securityGroup: aws.ec2.SecurityGroup;
    public readonly instances: aws.ec2.Instance[];
    public readonly instanceRole: aws.iam.Role;
    public readonly ssmAssociation: aws.ssm.Association;

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
        } as any, { parent: this });
        
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
                // Allow sockperf ports
                {
                    protocol: "udp",
                    fromPort: 11110,
                    toPort: 11120,
                    cidrBlocks: ["0.0.0.0/0"],
                    description: "Allow sockperf UDP ports",
                },
                {
                    protocol: "tcp",
                    fromPort: 11110,
                    toPort: 11120,
                    cidrBlocks: ["0.0.0.0/0"],
                    description: "Allow sockperf TCP ports",
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

        // Create instances
        this.instances = [];

        // Define instance names
        const instanceNames = ["sockperf-server-dh", "sockperf-client-dh"];

        // Create instances based on the configuration
        for (let i = 0; i < args.instanceCount; i++) {
            const instance = new aws.ec2.Instance(`${name}-instance-${i+1}`, {
                ami: ami.id,
                instanceType: args.instanceType,
                subnetId: this.subnet.id,
                vpcSecurityGroupIds: [this.securityGroup.id],
                keyName: args.keyPairName,
                hostId: this.dedicatedHost.id,
                iamInstanceProfile: instanceProfile.name,
                tags: {
                    Name: `${args.stackName}-${instanceNames[i]}`,
                },
            }, { 
                parent: this,
                dependsOn: [ssmPolicyAttachment], // Ensure policy is attached before instance is created
            });
            this.instances.push(instance);
        }

        // Create SSM document for sockperf installation
        const sockperfDocument = new aws.ssm.Document(`${name}-sockperf-document`, {
            documentType: "Command",
            content: JSON.stringify({
                schemaVersion: "2.2",
                description: "Install sockperf and node_exporter",
                parameters: {},
                mainSteps: [
                    {
                        action: "aws:runShellScript",
                        name: "installSockperf",
                        inputs: {
                            runCommand: [
                                "#!/bin/bash",
                                "# Log file for installation process",
                                "INSTALL_LOG=\"/var/log/sockperf_install.log\"",
                                "exec > >(tee -a $INSTALL_LOG) 2>&1",
                                "",
                                "echo \"$(date '+%Y-%m-%d %H:%M:%S') - Starting sockperf installation\"",
                                "",
                                "# Define variables",
                                "SOCKPERF_VERSION=\"3.10\"",
                                "DOWNLOAD_URL=\"https://github.com/Mellanox/sockperf/archive/refs/tags/$SOCKPERF_VERSION.zip\"",
                                "DOWNLOAD_FILE=\"sockperf-$SOCKPERF_VERSION.zip\"",
                                "EXTRACT_DIR=\"sockperf-$SOCKPERF_VERSION\"",
                                "STATUS_FILE=\"/var/log/sockperf_install.status\"",
                                "",
                                "# Update system packages",
                                "echo \"Updating system packages...\"",
                                "dnf update -y",
                                "",
                                "# Install dependencies",
                                "echo \"Installing dependencies...\"",
                                "dnf groupinstall -y \"Development Tools\"",
                                "dnf install -y wget unzip ethtool htop screen",
                                "",
                                "# Create a temporary directory for the installation",
                                "TEMP_DIR=$(mktemp -d)",
                                "echo \"Working in temporary directory: $TEMP_DIR\"",
                                "cd \"$TEMP_DIR\"",
                                "",
                                "# Download sockperf",
                                "echo \"Downloading sockperf from $DOWNLOAD_URL...\"",
                                "wget --no-verbose --tries=3 --timeout=15 --continue \\",
                                "    --retry-connrefused --waitretry=1 --read-timeout=20 \\",
                                "    \"$DOWNLOAD_URL\" -O \"$DOWNLOAD_FILE\"",
                                "",
                                "# Extract the archive",
                                "echo \"Extracting sockperf...\"",
                                "unzip -q \"$DOWNLOAD_FILE\"",
                                "",
                                "# Build and install sockperf",
                                "cd \"$EXTRACT_DIR\"",
                                "echo \"Running autogen.sh...\"",
                                "./autogen.sh",
                                "",
                                "echo \"Running configure...\"",
                                "./configure",
                                "",
                                "echo \"Running make...\"",
                                "make",
                                "",
                                "echo \"Running make install...\"",
                                "make install",
                                "",
                                "# Test the installation",
                                "echo \"Testing sockperf installation...\"",
                                "SOCKPERF_VERSION_OUTPUT=$(sockperf --version 2>&1)",
                                "echo \"sockperf version: $SOCKPERF_VERSION_OUTPUT\"",
                                "",
                                "# Clean up",
                                "echo \"Cleaning up temporary files...\"",
                                "cd / && rm -rf \"$TEMP_DIR\"",
                                "",
                                "# Create a status file to indicate success",
                                "echo \"SUCCESS: sockperf $SOCKPERF_VERSION installed successfully at $(date)\" > \"$STATUS_FILE\"",
                                "",
                                "echo \"sockperf installation complete!\"",
                                "",
                                "# Install node_exporter",
                                "echo \"Starting node_exporter installation\"",
                                "",
                                "# Define variables",
                                "NODE_EXPORTER_VERSION=\"1.6.1\"",
                                "DOWNLOAD_URL=\"https://github.com/prometheus/node_exporter/releases/download/v$NODE_EXPORTER_VERSION/node_exporter-$NODE_EXPORTER_VERSION.linux-amd64.tar.gz\"",
                                "DOWNLOAD_FILE=\"node_exporter-$NODE_EXPORTER_VERSION.linux-amd64.tar.gz\"",
                                "EXTRACT_DIR=\"node_exporter-$NODE_EXPORTER_VERSION.linux-amd64\"",
                                "BINARY_PATH=\"/usr/local/bin/node_exporter\"",
                                "SERVICE_FILE=\"/etc/systemd/system/node_exporter.service\"",
                                "STATUS_FILE=\"/var/log/node_exporter_install.status\"",
                                "",
                                "# Create a temporary directory for the installation",
                                "TEMP_DIR=$(mktemp -d)",
                                "echo \"Working in temporary directory: $TEMP_DIR\"",
                                "cd \"$TEMP_DIR\"",
                                "",
                                "# Download node_exporter",
                                "echo \"Downloading node_exporter from $DOWNLOAD_URL...\"",
                                "wget --no-verbose --tries=3 --timeout=15 --continue \\",
                                "    --retry-connrefused --waitretry=1 --read-timeout=20 \\",
                                "    \"$DOWNLOAD_URL\" -O \"$DOWNLOAD_FILE\"",
                                "",
                                "# Extract the archive",
                                "echo \"Extracting node_exporter...\"",
                                "tar xzf \"$DOWNLOAD_FILE\"",
                                "",
                                "# Move binary to /usr/local/bin",
                                "echo \"Installing node_exporter binary to $BINARY_PATH...\"",
                                "mv \"$EXTRACT_DIR/node_exporter\" \"$BINARY_PATH\"",
                                "",
                                "# Create node_exporter user if it doesn't exist",
                                "echo \"Creating node_exporter user...\"",
                                "id -u node_exporter &>/dev/null || useradd -rs /bin/false node_exporter",
                                "",
                                "# Create systemd service file",
                                "echo \"Creating systemd service file...\"",
                                "cat > \"$SERVICE_FILE\" << 'EOF'",
                                "[Unit]",
                                "Description=Node Exporter",
                                "After=network.target",
                                "",
                                "[Service]",
                                "User=node_exporter",
                                "Group=node_exporter",
                                "Type=simple",
                                "ExecStart=/usr/local/bin/node_exporter",
                                "",
                                "[Install]",
                                "WantedBy=multi-user.target",
                                "EOF",
                                "",
                                "# Reload systemd configuration",
                                "echo \"Reloading systemd configuration...\"",
                                "systemctl daemon-reload",
                                "",
                                "# Enable the service",
                                "echo \"Enabling node_exporter service...\"",
                                "systemctl enable node_exporter",
                                "",
                                "# Start the service",
                                "echo \"Starting node_exporter service...\"",
                                "systemctl start node_exporter",
                                "",
                                "# Clean up",
                                "echo \"Cleaning up temporary files...\"",
                                "cd / && rm -rf \"$TEMP_DIR\"",
                                "",
                                "# Create a status file to indicate success",
                                "echo \"SUCCESS: node_exporter $NODE_EXPORTER_VERSION installed successfully at $(date)\" > \"$STATUS_FILE\"",
                                "",
                                "echo \"node_exporter installation complete!\"",
                                "",
                                "echo \"All installation tasks completed successfully!\""
                            ]
                        }
                    }
                ]
            }),
            tags: {
                Name: `${args.stackName}-sockperf-document`,
            },
        }, { parent: this });

        // Create SSM association to run the document on the instances
        const instanceIds = pulumi.output(this.instances).apply(instances => 
            instances.map(instance => instance.id)
        );

        this.ssmAssociation = new aws.ssm.Association(`${name}-sockperf-association`, {
            name: sockperfDocument.name,
            targets: [{
                key: "InstanceIds",
                values: instanceIds,
            }],
            applyOnlyAtCronInterval: false,
            scheduleExpression: "rate(1 day)",
            complianceSeverity: "MEDIUM",
            maxConcurrency: "100%",
            maxErrors: "0",
        }, { parent: this });

        this.registerOutputs({
            subnetId: this.subnet.id,
            dedicatedHostId: this.dedicatedHost.id,
            securityGroupId: this.securityGroup.id,
            availabilityZone: this.subnet.availabilityZone,
            instanceIds: pulumi.output(this.instances).apply(instances => instances.map(instance => instance.id)),
            instancePublicIps: pulumi.output(this.instances).apply(instances => 
                instances.map((instance, i) => ({ 
                    name: instanceNames[i],
                    publicIp: instance.publicIp 
                }))
            ),
        });
    }
}
