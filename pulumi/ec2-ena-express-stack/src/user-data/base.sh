#!/bin/bash

# Log file for installation process
INSTALL_LOG="/var/log/user_data_install.log"
exec > >(tee -a $INSTALL_LOG) 2>&1

echo "$(date '+%Y-%m-%d %H:%M:%S') - Starting installation process"

# Function to log messages with timestamps
log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# Function to handle errors
handle_error() {
  local exit_code=$1
  local error_msg=$2
  log "ERROR: $error_msg (Exit code: $exit_code)"
  exit $exit_code
}

#############################
# Install sockperf
#############################
log "Starting sockperf installation"

# Define variables
SOCKPERF_VERSION="3.10"
DOWNLOAD_URL="https://github.com/Mellanox/sockperf/archive/refs/tags/$SOCKPERF_VERSION.zip"
DOWNLOAD_FILE="sockperf-$SOCKPERF_VERSION.zip"
EXTRACT_DIR="sockperf-$SOCKPERF_VERSION"
STATUS_FILE="/var/log/sockperf_install.status"

# Update system packages
log "Updating system packages..."
dnf update -y || handle_error 1 "Failed to update system packages"

# Install dependencies
log "Installing dependencies..."
dnf groupinstall -y "Development Tools" || handle_error 2 "Failed to install Development Tools"
dnf install -y wget unzip ethtool htop screen || handle_error 3 "Failed to install required packages"

# Create a temporary directory for the installation
TEMP_DIR=$(mktemp -d) || handle_error 4 "Failed to create temporary directory"
log "Working in temporary directory: $TEMP_DIR"
cd "$TEMP_DIR" || handle_error 5 "Failed to change to temporary directory"

# Download sockperf
log "Downloading sockperf from $DOWNLOAD_URL..."
wget --no-verbose --tries=3 --timeout=15 --continue \
    --retry-connrefused --waitretry=1 --read-timeout=20 \
    "$DOWNLOAD_URL" -O "$DOWNLOAD_FILE" || handle_error 6 "Failed to download sockperf"

# Verify the download
if [ ! -s "$DOWNLOAD_FILE" ]; then
  handle_error 7 "Downloaded file is empty or does not exist"
fi

# Extract the archive
log "Extracting sockperf..."
unzip -q "$DOWNLOAD_FILE" || handle_error 8 "Failed to extract sockperf archive"

# Verify extraction
if [ ! -d "$EXTRACT_DIR" ]; then
  handle_error 9 "Extraction directory not found"
fi

# Build and install sockperf
cd "$EXTRACT_DIR" || handle_error 10 "Failed to change to sockperf directory"
log "Running autogen.sh..."
./autogen.sh || handle_error 11 "Failed to run autogen.sh"

log "Running configure..."
./configure || handle_error 12 "Failed to run configure"

log "Running make..."
make || handle_error 13 "Failed to build sockperf"

log "Running make install..."
make install || handle_error 14 "Failed to install sockperf"

# Test the installation
log "Testing sockperf installation..."
SOCKPERF_VERSION_OUTPUT=$(sockperf --version 2>&1) || handle_error 15 "Failed to run sockperf --version"
log "sockperf version: $SOCKPERF_VERSION_OUTPUT"

# Clean up
log "Cleaning up temporary files..."
cd / && rm -rf "$TEMP_DIR"

# Create a status file to indicate success
echo "SUCCESS: sockperf $SOCKPERF_VERSION installed successfully at $(date)" > "$STATUS_FILE"

log "sockperf installation complete!"

#############################
# Install node_exporter
#############################
log "Starting node_exporter installation"

# Define variables
NODE_EXPORTER_VERSION="1.6.1"
DOWNLOAD_URL="https://github.com/prometheus/node_exporter/releases/download/v$NODE_EXPORTER_VERSION/node_exporter-$NODE_EXPORTER_VERSION.linux-amd64.tar.gz"
DOWNLOAD_FILE="node_exporter-$NODE_EXPORTER_VERSION.linux-amd64.tar.gz"
EXTRACT_DIR="node_exporter-$NODE_EXPORTER_VERSION.linux-amd64"
BINARY_PATH="/usr/local/bin/node_exporter"
SERVICE_FILE="/etc/systemd/system/node_exporter.service"
STATUS_FILE="/var/log/node_exporter_install.status"

# Create a temporary directory for the installation
TEMP_DIR=$(mktemp -d) || handle_error 1 "Failed to create temporary directory"
log "Working in temporary directory: $TEMP_DIR"
cd "$TEMP_DIR" || handle_error 2 "Failed to change to temporary directory"

# Download node_exporter
log "Downloading node_exporter from $DOWNLOAD_URL..."
wget --no-verbose --tries=3 --timeout=15 --continue \
    --retry-connrefused --waitretry=1 --read-timeout=20 \
    "$DOWNLOAD_URL" -O "$DOWNLOAD_FILE" || handle_error 3 "Failed to download node_exporter"

# Verify the download
if [ ! -s "$DOWNLOAD_FILE" ]; then
  handle_error 4 "Downloaded file is empty or does not exist"
fi

# Extract the archive
log "Extracting node_exporter..."
tar xzf "$DOWNLOAD_FILE" || handle_error 5 "Failed to extract node_exporter archive"

# Verify extraction
if [ ! -d "$EXTRACT_DIR" ]; then
  handle_error 6 "Extraction directory not found"
fi

# Move binary to /usr/local/bin
log "Installing node_exporter binary to $BINARY_PATH..."
mv "$EXTRACT_DIR/node_exporter" "$BINARY_PATH" || handle_error 7 "Failed to install node_exporter binary"

# Verify binary exists and is executable
if [ ! -x "$BINARY_PATH" ]; then
  handle_error 8 "node_exporter binary is not executable after installation"
fi

# Create node_exporter user if it doesn't exist
log "Creating node_exporter user..."
id -u node_exporter &>/dev/null || useradd -rs /bin/false node_exporter || handle_error 9 "Failed to create node_exporter user"

# Create systemd service file
log "Creating systemd service file..."
cat > "$SERVICE_FILE" << 'EOF' || handle_error 10 "Failed to create service file"
[Unit]
Description=Node Exporter
After=network.target

[Service]
User=node_exporter
Group=node_exporter
Type=simple
ExecStart=/usr/local/bin/node_exporter

[Install]
WantedBy=multi-user.target
EOF

# Verify service file exists
if [ ! -f "$SERVICE_FILE" ]; then
  handle_error 11 "Service file was not created properly"
fi

# Reload systemd configuration
log "Reloading systemd configuration..."
systemctl daemon-reload || handle_error 12 "Failed to reload systemd configuration"

# Enable the service
log "Enabling node_exporter service..."
systemctl enable node_exporter || handle_error 13 "Failed to enable node_exporter service"

# Start the service
log "Starting node_exporter service..."
systemctl start node_exporter || handle_error 14 "Failed to start node_exporter service"

# Verify the service is running
log "Verifying node_exporter service status..."
systemctl is-active --quiet node_exporter || handle_error 15 "node_exporter service is not running after start"

# Clean up
log "Cleaning up temporary files..."
cd / && rm -rf "$TEMP_DIR"

# Create a status file to indicate success
echo "SUCCESS: node_exporter $NODE_EXPORTER_VERSION installed successfully at $(date)" > "$STATUS_FILE"

log "node_exporter installation complete!"

#############################
# Download benchmark script
#############################
log "Starting benchmark script download"

# Define variables
SCRIPT_URL="https://raw.githubusercontent.com/zhang1980s/ec2-ena-express-lab/master/scripts/ena_express_latency_benchmark.sh"
DEST_DIR="/home/ec2-user"
SCRIPT_NAME="ena_express_latency_benchmark.sh"
FULL_PATH="$DEST_DIR/$SCRIPT_NAME"
STATUS_FILE="$DEST_DIR/.$SCRIPT_NAME.status"

# Check if destination directory exists
if [ ! -d "$DEST_DIR" ]; then
  handle_error 1 "Destination directory $DEST_DIR does not exist"
fi

# Change to destination directory
cd "$DEST_DIR" || handle_error 2 "Failed to change to directory $DEST_DIR"

# Download the script
log "Downloading from $SCRIPT_URL..."
wget --no-verbose --tries=3 --timeout=15 --continue \
    --retry-connrefused --waitretry=1 --read-timeout=20 \
    "$SCRIPT_URL" -O "$SCRIPT_NAME" || handle_error 3 "Failed to download script from $SCRIPT_URL"

# Verify the file exists and is not empty
if [ ! -s "$SCRIPT_NAME" ]; then
  handle_error 4 "Downloaded file is empty or does not exist"
fi

# Make the script executable
log "Setting executable permissions..."
chmod +x "$SCRIPT_NAME" || handle_error 5 "Failed to set executable permissions"

# Set ownership to ec2-user
log "Setting ownership to ec2-user..."
chown ec2-user:ec2-user "$SCRIPT_NAME" || handle_error 6 "Failed to set ownership"

# Verify the script is executable
if [ ! -x "$SCRIPT_NAME" ]; then
  handle_error 7 "Script is not executable after chmod"
fi

# Create a status file to indicate success
echo "SUCCESS: Script downloaded and configured successfully at $(date)" > "$STATUS_FILE"
chown ec2-user:ec2-user "$STATUS_FILE" || log "Warning: Could not set ownership on status file"

log "Benchmark script download complete. Script is available at $FULL_PATH"

#############################
# Configure GRUB to disable C-states
#############################
log "Configuring GRUB to disable CPU C-states"

# Define variables
GRUB_CONFIG_FILE="/etc/default/grub"
GRUB_PARAMS="intel_idle.max_cstate=0 processor.max_cstate=0"
GRUB_STATUS_FILE="/var/log/grub_config.status"

# Check if GRUB config file exists
if [ ! -f "${GRUB_CONFIG_FILE}" ]; then
  handle_error 1 "GRUB configuration file not found at ${GRUB_CONFIG_FILE}"
fi

# Backup the original GRUB config
log "Backing up original GRUB configuration..."
cp "${GRUB_CONFIG_FILE}" "${GRUB_CONFIG_FILE}.bak" || handle_error 2 "Failed to backup GRUB configuration"

# Check if parameters are already in GRUB config
if grep -q "${GRUB_PARAMS}" "${GRUB_CONFIG_FILE}"; then
  log "C-state parameters already present in GRUB configuration"
else
  log "Adding C-state parameters to GRUB configuration..."
  
  # Update GRUB_CMDLINE_LINUX_DEFAULT
  if grep -q "GRUB_CMDLINE_LINUX_DEFAULT=" "${GRUB_CONFIG_FILE}"; then
    # If the parameter exists, append to it
    sed -i "s/GRUB_CMDLINE_LINUX_DEFAULT=\"\(.*\)\"/GRUB_CMDLINE_LINUX_DEFAULT=\"\1 ${GRUB_PARAMS}\"/" "${GRUB_CONFIG_FILE}" || \
      handle_error 3 "Failed to update GRUB_CMDLINE_LINUX_DEFAULT"
  else
    # If the parameter doesn't exist, add it
    echo "GRUB_CMDLINE_LINUX_DEFAULT=\"${GRUB_PARAMS}\"" >> "${GRUB_CONFIG_FILE}" || \
      handle_error 4 "Failed to add GRUB_CMDLINE_LINUX_DEFAULT"
  fi
  
  # Update GRUB configuration
  log "Updating GRUB configuration..."
  grub2-mkconfig -o /boot/grub2/grub.cfg || handle_error 5 "Failed to update GRUB configuration"
  
  # Create a status file to indicate success
  echo "SUCCESS: GRUB configured to disable CPU C-states at $(date)" > "${GRUB_STATUS_FILE}"
  
  log "GRUB configuration complete. The system will reboot to apply changes."
  
  # Schedule a reboot in 1 minute to allow other initialization tasks to complete
  log "Scheduling system reboot in 1 minute..."
  (sleep 60 && reboot) &
fi

log "All installation tasks completed successfully!"
