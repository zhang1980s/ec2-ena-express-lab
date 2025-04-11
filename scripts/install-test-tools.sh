#!/bin/bash
# Script to install sockperf for network performance testing on Amazon Linux 2023
# For ENA vs ENA Express latency and bandwidth performance testing

set -e

echo "Updating system packages..."
sudo dnf update -y

echo "Installing dependencies for sockperf..."
sudo dnf groupinstall -y "Development Tools"
sudo dnf install -y wget unzip

echo "Downloading and installing sockperf..."
wget https://github.com/Mellanox/sockperf/archive/refs/tags/3.10.zip
unzip 3.10.zip
cd sockperf-3.10
./autogen.sh
./configure
make
sudo make install

echo "Testing sockperf installation..."
echo "sockperf version: $(sockperf --version)"

echo "Installation complete!"
echo "You can now run performance tests between your instances using sockperf."
