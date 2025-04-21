#!/bin/bash
# Set hostname
hostnamectl set-hostname sockperf-client.zzhe.xyz
echo "127.0.0.1 sockperf-client.zzhe.xyz" >> /etc/hosts

# Source the base script
source /tmp/base.sh
