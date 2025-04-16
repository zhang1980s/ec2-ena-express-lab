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
                                "set -e  # Exit immediately if a command exits with a non-zero status",
                                "",
                                "# Define variables",
                                "SOCKPERF_VERSION=\"3.10\"",
                                "DOWNLOAD_URL=\"https://github.com/Mellanox/sockperf/archive/refs/tags/${SOCKPERF_VERSION}.zip\"",
                                "DOWNLOAD_FILE=\"sockperf-${SOCKPERF_VERSION}.zip\"",
                                "EXTRACT_DIR=\"sockperf-${SOCKPERF_VERSION}\"",
                                "STATUS_FILE=\"/var/log/sockperf_install.status\"",
                                "",
                                "# Function to log messages with timestamps",
                                "log() {",
                                "  echo \"$(date '+%Y-%m-%d %H:%M:%S') - $1\"",
                                "}",
                                "",
                                "# Function to handle errors",
                                "handle_error() {",
                                "  local exit_code=$1",
                                "  local error_msg=$2",
                                "  log \"ERROR: ${error_msg} (Exit code: ${exit_code})\"",
                                "  echo \"FAILED: ${error_msg}\" > \"${STATUS_FILE}\"",
                                "  exit ${exit_code}",
                                "}",
                                "",
                                "# Start execution",
                                "log \"Starting sockperf installation (version ${SOCKPERF_VERSION})\"",
                                "",
                                "# Update system packages",
                                "log \"Updating system packages...\"",
                                "dnf update -y || handle_error 1 \"Failed to update system packages\"",
                                "",
                                "# Install dependencies",
                                "log \"Installing dependencies...\"",
                                "dnf groupinstall -y \"Development Tools\" || handle_error 2 \"Failed to install Development Tools\"",
                                "dnf install -y wget unzip ethtool htop || handle_error 3 \"Failed to install required packages\"",
                                "",
                                "# Create a temporary directory for the installation",
                                "TEMP_DIR=$(mktemp -d) || handle_error 4 \"Failed to create temporary directory\"",
                                "log \"Working in temporary directory: ${TEMP_DIR}\"",
                                "cd \"${TEMP_DIR}\" || handle_error 5 \"Failed to change to temporary directory\"",
                                "",
                                "# Download sockperf",
                                "log \"Downloading sockperf from ${DOWNLOAD_URL}...\"",
                                "wget -q \"${DOWNLOAD_URL}\" -O \"${DOWNLOAD_FILE}\" || handle_error 6 \"Failed to download sockperf\"",
                                "",
                                "# Verify the download",
                                "if [ ! -s \"${DOWNLOAD_FILE}\" ]; then",
                                "  handle_error 7 \"Downloaded file is empty or does not exist\"",
                                "fi",
                                "",
                                "# Extract the archive",
                                "log \"Extracting sockperf...\"",
                                "unzip -q \"${DOWNLOAD_FILE}\" || handle_error 8 \"Failed to extract sockperf archive\"",
                                "",
                                "# Verify extraction",
                                "if [ ! -d \"${EXTRACT_DIR}\" ]; then",
                                "  handle_error 9 \"Extraction directory not found\"",
                                "fi",
                                "",
                                "# Build and install sockperf",
                                "cd \"${EXTRACT_DIR}\" || handle_error 10 \"Failed to change to sockperf directory\"",
                                "log \"Running autogen.sh...\"",
                                "./autogen.sh || handle_error 11 \"Failed to run autogen.sh\"",
                                "",
                                "log \"Running configure...\"",
                                "./configure || handle_error 12 \"Failed to run configure\"",
                                "",
                                "log \"Running make...\"",
                                "make || handle_error 13 \"Failed to build sockperf\"",
                                "",
                                "log \"Running make install...\"",
                                "make install || handle_error 14 \"Failed to install sockperf\"",
                                "",
                                "# Test the installation",
                                "log \"Testing sockperf installation...\"",
                                "SOCKPERF_VERSION_OUTPUT=$(sockperf --version 2>&1) || handle_error 15 \"Failed to run sockperf --version\"",
                                "log \"sockperf version: ${SOCKPERF_VERSION_OUTPUT}\"",
                                "",
                                "# Clean up",
                                "log \"Cleaning up temporary files...\"",
                                "cd / && rm -rf \"${TEMP_DIR}\"",
                                "",
                                "# Create a status file to indicate success",
                                "echo \"SUCCESS: sockperf ${SOCKPERF_VERSION} installed successfully at $(date)\" > \"${STATUS_FILE}\"",
                                "",
                                "log \"Installation complete! sockperf is now available.\"",
                                "",
                                "# Return success",
                                "exit 0"
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
                                "# Install node_exporter for system metrics collection",
                                "set -e  # Exit immediately if a command exits with a non-zero status",
                                "",
                                "# Define variables",
                                "NODE_EXPORTER_VERSION=\"1.6.1\"",
                                "DOWNLOAD_URL=\"https://github.com/prometheus/node_exporter/releases/download/v${NODE_EXPORTER_VERSION}/node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz\"",
                                "DOWNLOAD_FILE=\"node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64.tar.gz\"",
                                "EXTRACT_DIR=\"node_exporter-${NODE_EXPORTER_VERSION}.linux-amd64\"",
                                "BINARY_PATH=\"/usr/local/bin/node_exporter\"",
                                "SERVICE_FILE=\"/etc/systemd/system/node_exporter.service\"",
                                "STATUS_FILE=\"/var/log/node_exporter_install.status\"",
                                "",
                                "# Function to log messages with timestamps",
                                "log() {",
                                "  echo \"$(date '+%Y-%m-%d %H:%M:%S') - $1\"",
                                "}",
                                "",
                                "# Function to handle errors",
                                "handle_error() {",
                                "  local exit_code=$1",
                                "  local error_msg=$2",
                                "  log \"ERROR: ${error_msg} (Exit code: ${exit_code})\"",
                                "  echo \"FAILED: ${error_msg}\" > \"${STATUS_FILE}\"",
                                "  exit ${exit_code}",
                                "}",
                                "",
                                "# Start execution",
                                "log \"Starting node_exporter installation (version ${NODE_EXPORTER_VERSION})\"",
                                "",
                                "# Create a temporary directory for the installation",
                                "TEMP_DIR=$(mktemp -d) || handle_error 1 \"Failed to create temporary directory\"",
                                "log \"Working in temporary directory: ${TEMP_DIR}\"",
                                "cd \"${TEMP_DIR}\" || handle_error 2 \"Failed to change to temporary directory\"",
                                "",
                                "# Download node_exporter",
                                "log \"Downloading node_exporter from ${DOWNLOAD_URL}...\"",
                                "wget -q \"${DOWNLOAD_URL}\" -O \"${DOWNLOAD_FILE}\" || handle_error 3 \"Failed to download node_exporter\"",
                                "",
                                "# Verify the download",
                                "if [ ! -s \"${DOWNLOAD_FILE}\" ]; then",
                                "  handle_error 4 \"Downloaded file is empty or does not exist\"",
                                "fi",
                                "",
                                "# Extract the archive",
                                "log \"Extracting node_exporter...\"",
                                "tar xzf \"${DOWNLOAD_FILE}\" || handle_error 5 \"Failed to extract node_exporter archive\"",
                                "",
                                "# Verify extraction",
                                "if [ ! -d \"${EXTRACT_DIR}\" ]; then",
                                "  handle_error 6 \"Extraction directory not found\"",
                                "fi",
                                "",
                                "# Move binary to /usr/local/bin",
                                "log \"Installing node_exporter binary to ${BINARY_PATH}...\"",
                                "mv \"${EXTRACT_DIR}/node_exporter\" \"${BINARY_PATH}\" || handle_error 7 \"Failed to install node_exporter binary\"",
                                "",
                                "# Verify binary exists and is executable",
                                "if [ ! -x \"${BINARY_PATH}\" ]; then",
                                "  handle_error 8 \"node_exporter binary is not executable after installation\"",
                                "fi",
                                "",
                                "# Create node_exporter user if it doesn't exist",
                                "log \"Creating node_exporter user...\"",
                                "id -u node_exporter &>/dev/null || useradd -rs /bin/false node_exporter || handle_error 9 \"Failed to create node_exporter user\"",
                                "",
                                "# Create systemd service file",
                                "log \"Creating systemd service file...\"",
                                "cat > \"${SERVICE_FILE}\" << 'EOF' || handle_error 10 \"Failed to create service file\"",
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
                                "# Verify service file exists",
                                "if [ ! -f \"${SERVICE_FILE}\" ]; then",
                                "  handle_error 11 \"Service file was not created properly\"",
                                "fi",
                                "",
                                "# Reload systemd configuration",
                                "log \"Reloading systemd configuration...\"",
                                "systemctl daemon-reload || handle_error 12 \"Failed to reload systemd configuration\"",
                                "",
                                "# Enable the service",
                                "log \"Enabling node_exporter service...\"",
                                "systemctl enable node_exporter || handle_error 13 \"Failed to enable node_exporter service\"",
                                "",
                                "# Start the service",
                                "log \"Starting node_exporter service...\"",
                                "systemctl start node_exporter || handle_error 14 \"Failed to start node_exporter service\"",
                                "",
                                "# Verify the service is running",
                                "log \"Verifying node_exporter service status...\"",
                                "systemctl is-active --quiet node_exporter || handle_error 15 \"node_exporter service is not running after start\"",
                                "",
                                "# Clean up",
                                "log \"Cleaning up temporary files...\"",
                                "cd / && rm -rf \"${TEMP_DIR}\"",
                                "",
                                "# Create a status file to indicate success",
                                "echo \"SUCCESS: node_exporter ${NODE_EXPORTER_VERSION} installed successfully at $(date)\" > \"${STATUS_FILE}\"",
                                "",
                                "log \"Installation complete! node_exporter is now running.\"",
                                "",
                                "# Return success",
                                "exit 0"
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
                                "# Download the ena_express_latency_benchmark.sh script to ec2-user's home directory",
                                "set -e  # Exit immediately if a command exits with a non-zero status",
                                "",
                                "# Define variables",
                                "SCRIPT_URL=\"https://raw.githubusercontent.com/zhang1980s/ec2-ena-express-lab/master/scripts/ena_express_latency_benchmark.sh\"",
                                "DEST_DIR=\"/home/ec2-user\"",
                                "SCRIPT_NAME=\"ena_express_latency_benchmark.sh\"",
                                "FULL_PATH=\"${DEST_DIR}/${SCRIPT_NAME}\"",
                                "STATUS_FILE=\"${DEST_DIR}/.${SCRIPT_NAME}.status\"",
                                "",
                                "# Function to log messages with timestamps",
                                "log() {",
                                "  echo \"$(date '+%Y-%m-%d %H:%M:%S') - $1\"",
                                "}",
                                "",
                                "# Function to handle errors",
                                "handle_error() {",
                                "  local exit_code=$1",
                                "  local error_msg=$2",
                                "  log \"ERROR: ${error_msg} (Exit code: ${exit_code})\"",
                                "  echo \"FAILED: ${error_msg}\" > \"${STATUS_FILE}\"",
                                "  exit ${exit_code}",
                                "}",
                                "",
                                "# Start execution",
                                "log \"Starting download of ${SCRIPT_NAME} to ${DEST_DIR}\"",
                                "",
                                "# Check if destination directory exists",
                                "if [ ! -d \"${DEST_DIR}\" ]; then",
                                "  handle_error 1 \"Destination directory ${DEST_DIR} does not exist\"",
                                "fi",
                                "",
                                "# Change to destination directory",
                                "cd \"${DEST_DIR}\" || handle_error 2 \"Failed to change to directory ${DEST_DIR}\"",
                                "",
                                "# Download the script",
                                "log \"Downloading from ${SCRIPT_URL}...\"",
                                "wget -q \"${SCRIPT_URL}\" -O \"${SCRIPT_NAME}\" || handle_error 3 \"Failed to download script from ${SCRIPT_URL}\"",
                                "",
                                "# Verify the file exists and is not empty",
                                "if [ ! -s \"${SCRIPT_NAME}\" ]; then",
                                "  handle_error 4 \"Downloaded file is empty or does not exist\"",
                                "fi",
                                "",
                                "# Make the script executable",
                                "log \"Setting executable permissions...\"",
                                "chmod +x \"${SCRIPT_NAME}\" || handle_error 5 \"Failed to set executable permissions\"",
                                "",
                                "# Set ownership to ec2-user",
                                "log \"Setting ownership to ec2-user...\"",
                                "chown ec2-user:ec2-user \"${SCRIPT_NAME}\" || handle_error 6 \"Failed to set ownership\"",
                                "",
                                "# Verify the script is executable",
                                "if [ ! -x \"${SCRIPT_NAME}\" ]; then",
                                "  handle_error 7 \"Script is not executable after chmod\"",
                                "fi",
                                "",
                                "# Create a status file to indicate success",
                                "echo \"SUCCESS: Script downloaded and configured successfully at $(date)\" > \"${STATUS_FILE}\"",
                                "chown ec2-user:ec2-user \"${STATUS_FILE}\" || log \"Warning: Could not set ownership on status file\"",
                                "",
                                "log \"Download complete. Script is available at ${FULL_PATH}\"",
                                "log \"Status file created at ${STATUS_FILE}\"",
                                "",
                                "# Return success",
                                "exit 0"
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
