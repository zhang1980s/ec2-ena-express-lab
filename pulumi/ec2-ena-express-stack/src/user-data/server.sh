#!/bin/bash
# Set hostname
hostnamectl set-hostname sockperf-server.zzhe.xyz
echo "127.0.0.1 sockperf-server.zzhe.xyz" >> /etc/hosts

# Source the base script
source /tmp/base.sh
