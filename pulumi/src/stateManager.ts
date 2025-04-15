import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface StateManagerArgs {
    stackName: string;
    instances: aws.ec2.Instance[];
}

export class StateManager extends pulumi.ComponentResource {
    public readonly sockperfDocument: aws.ssm.Document;
    public readonly nodeExporterDocument: aws.ssm.Document;
    public readonly benchmarkScriptDocument: aws.ssm.Document;
    public readonly sockperfAssociation: aws.ssm.Association;
    public readonly nodeExporterAssociation: aws.ssm.Association;
    public readonly benchmarkScriptAssociation: aws.ssm.Association;

    constructor(name: string, args: StateManagerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("ec2-ena-express-lab:statemanager:StateManager", name, {}, opts);

        // Create SSM Document for sockperf installation
        this.sockperfDocument = new aws.ssm.Document(`${name}-sockperf-install`, {
            documentType: "Command",
            content: JSON.stringify({
                schemaVersion: "2.2",
                description: "Install sockperf for network performance testing",
                parameters: {},
                mainSteps: [
                    {
                        action: "aws:runShellScript",
                        name: "installSockperf",
                        inputs: {
                            runCommand: [
                                "#!/bin/bash",
                                "# Script to install sockperf for network performance testing on Amazon Linux 2023",
                                "# For ENA vs ENA Express latency and bandwidth performance testing",
                                "",
                                "set -e",
                                "",
                                "echo \"Updating system packages...\"",
                                "dnf update -y",
                                "",
                                "echo \"Installing dependencies for sockperf...\"",
                                "dnf groupinstall -y \"Development Tools\"",
                                "dnf install -y wget unzip ethtool htop",
                                "",
                                "echo \"Downloading and installing sockperf...\"",
                                "wget https://github.com/Mellanox/sockperf/archive/refs/tags/3.10.zip",
                                "unzip 3.10.zip",
                                "cd sockperf-3.10",
                                "./autogen.sh",
                                "./configure",
                                "make",
                                "make install",
                                "",
                                "echo \"Testing sockperf installation...\"",
                                "echo \"sockperf version: $(sockperf --version)\"",
                                "",
                                "echo \"Installation complete!\""
                            ]
                        }
                    }
                ]
            }),
            tags: {
                Name: `${args.stackName}-sockperf-install-document`,
            },
        }, { parent: this });

        // Create SSM Document for node_exporter installation
        this.nodeExporterDocument = new aws.ssm.Document(`${name}-node-exporter-install`, {
            documentType: "Command",
            content: JSON.stringify({
                schemaVersion: "2.2",
                description: "Install node_exporter for system metrics collection",
                parameters: {},
                mainSteps: [
                    {
                        action: "aws:runShellScript",
                        name: "installNodeExporter",
                        inputs: {
                            runCommand: [
                                "#!/bin/bash",
                                "# Install node_exporter",
                                "echo \"Installing node_exporter...\"",
                                "wget https://github.com/prometheus/node_exporter/releases/download/v1.6.1/node_exporter-1.6.1.linux-amd64.tar.gz",
                                "tar xvfz node_exporter-1.6.1.linux-amd64.tar.gz",
                                "sudo mv node_exporter-1.6.1.linux-amd64/node_exporter /usr/local/bin/",
                                "sudo useradd -rs /bin/false node_exporter",
                                "",
                                "# Create systemd service",
                                "cat > /etc/systemd/system/node_exporter.service << 'EOF'",
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
                                "# Enable and start the service",
                                "sudo systemctl daemon-reload",
                                "sudo systemctl enable node_exporter",
                                "sudo systemctl start node_exporter",
                                "echo \"node_exporter installation complete.\""
                            ]
                        }
                    }
                ]
            }),
            tags: {
                Name: `${args.stackName}-node-exporter-install-document`,
            },
        }, { parent: this });

        // Create SSM Document for downloading the benchmark script
        this.benchmarkScriptDocument = new aws.ssm.Document(`${name}-benchmark-script-download`, {
            documentType: "Command",
            content: JSON.stringify({
                schemaVersion: "2.2",
                description: "Download the ENA Express latency benchmark script",
                parameters: {},
                mainSteps: [
                    {
                        action: "aws:runShellScript",
                        name: "downloadBenchmarkScript",
                        inputs: {
                            runCommand: [
                                "#!/bin/bash",
                                "# Download the ena_express_latency_benchmark.sh script",
                                "echo \"Downloading ena_express_latency_benchmark.sh script from GitHub...\"",
                                "wget https://raw.githubusercontent.com/zhang1980s/ec2-ena-express-lab/master/scripts/ena_express_latency_benchmark.sh",
                                "chmod +x ena_express_latency_benchmark.sh",
                                "echo \"Download complete.\""
                            ]
                        }
                    }
                ]
            }),
            tags: {
                Name: `${args.stackName}-benchmark-script-download-document`,
            },
        }, { parent: this });

        // Extract instance IDs from the instances
        const instanceIds = args.instances.map(instance => instance.id);

        // Create State Manager Association for sockperf installation
        this.sockperfAssociation = new aws.ssm.Association(`${name}-sockperf-association`, {
            name: this.sockperfDocument.name,
            associationName: `${args.stackName}-sockperf-installation`,
            targets: [{
                key: "InstanceIds",
                values: instanceIds,
            }],
            applyOnlyAtCronInterval: false,
            automationTargetParameterName: "InstanceIds",
            complianceSeverity: "MEDIUM",
            maxConcurrency: "100%",
            maxErrors: "0",
            scheduleExpression: "rate(1 day)",
        }, { parent: this });

        // Create State Manager Association for node_exporter installation
        this.nodeExporterAssociation = new aws.ssm.Association(`${name}-node-exporter-association`, {
            name: this.nodeExporterDocument.name,
            associationName: `${args.stackName}-node-exporter-installation`,
            targets: [{
                key: "InstanceIds",
                values: instanceIds,
            }],
            applyOnlyAtCronInterval: false,
            automationTargetParameterName: "InstanceIds",
            complianceSeverity: "MEDIUM",
            maxConcurrency: "100%",
            maxErrors: "0",
            scheduleExpression: "rate(1 day)",
        }, { parent: this });

        // Create State Manager Association for benchmark script download
        this.benchmarkScriptAssociation = new aws.ssm.Association(`${name}-benchmark-script-association`, {
            name: this.benchmarkScriptDocument.name,
            associationName: `${args.stackName}-benchmark-script-download`,
            targets: [{
                key: "InstanceIds",
                values: instanceIds,
            }],
            applyOnlyAtCronInterval: false,
            automationTargetParameterName: "InstanceIds",
            complianceSeverity: "MEDIUM",
            maxConcurrency: "100%",
            maxErrors: "0",
            scheduleExpression: "rate(1 day)",
        }, { parent: this });

        this.registerOutputs({
            sockperfDocumentName: this.sockperfDocument.name,
            nodeExporterDocumentName: this.nodeExporterDocument.name,
            benchmarkScriptDocumentName: this.benchmarkScriptDocument.name,
        });
    }
}
