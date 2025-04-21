#!/usr/bin/env python3

import argparse
import datetime
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Tuple, Union, Optional
import concurrent.futures

# Configuration parameters
SERVER_IP_ENI = "192.168.3.10"
SERVER_IP_SRD = "192.168.3.11"
SERVER_PORT_ENI = 11110
SERVER_PORT_SRD = 11111
CLIENT_IP_ENI = "192.168.3.20"
CLIENT_IP_SRD = "192.168.3.21"
CLIENT_PINGPONG_PORT_ENI = 10000
CLIENT_PINGPONG_PORT_SRD = 10001
CLIENT_BANDWIDTH_PORT_ENI = 10010
CLIENT_BANDWIDTH_PORT_SRD = 10011

# Test parameters
ITERATIONS = 1
REPEAT = 1
TEST_DURATION = 600  # Test duration in seconds
PRE_WARM_WAIT = 30   # Pre-warmup wait time in seconds
MPS = "max"          # Messages per second

# ANSI color codes for terminal output
class Colors:
    HEADER = '\033[95m'
    BLUE = '\033[94m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    RED = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'

def debug_print(message: str, debug: bool = False):
    """Print debug messages if debug mode is enabled."""
    if debug:
        print(f"DEBUG: {message}")

def check_sockperf_server(remote_ip: str, remote_port: int, test_type: str, debug: bool = False) -> bool:
    """Check if sockperf server is running at the specified IP and port."""
    print(f"Checking if sockperf server is running at {remote_ip}:{remote_port} ({test_type})...")
    
    output_file = f"/tmp/sockperf_check_{test_type}.log"
    
    try:
        # Try a simple ping-pong test with a short timeout
        cmd = f"timeout 5 sockperf ping-pong -i {remote_ip} -p {remote_port} --time 1"
        result = subprocess.run(cmd, shell=True, stdout=open(output_file, 'w'), stderr=subprocess.STDOUT)
        
        if result.returncode != 0:
            print(f"ERROR: sockperf server at {remote_ip}:{remote_port} ({test_type}) is not responding.")
            print("Error details:")
            with open(output_file, 'r') as f:
                print(f.read())
            
            print("")
            print(f"Please make sure the server is running with:")
            print(f"  sockperf server -i {remote_ip} -p {remote_port}")
            
            # Try to ping the server to check basic connectivity
            print(f"Checking basic connectivity to {remote_ip}...")
            ping_result = subprocess.run(f"ping -c 1 {remote_ip}", shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if ping_result.returncode == 0:
                print("Ping successful. The host is reachable but sockperf server may not be running.")
            else:
                print("Ping failed. The host may be unreachable.")
            
            return False
        else:
            print(f"sockperf server at {remote_ip}:{remote_port} ({test_type}) is running.")
            return True
    except Exception as e:
        print(f"Error checking sockperf server: {e}")
        return False

def run_sockperf_test(test_type: str, test_mode: str, remote_ip: str, remote_port: int, 
                     local_ip: str, local_port: int, output_file: str, iteration: int, 
                     repeat: int, debug: bool = False) -> bool:
    """Run a sockperf test with the specified parameters."""
    five_tuple = f"{local_ip}:{local_port}->{remote_ip}:{remote_port}/UDP"
    
    if test_mode == "latency":
        print(f"  - Running {test_type} latency test...")
        cmd = (f"sockperf ping-pong -i {remote_ip} -p {remote_port} "
               f"--client_ip {local_ip} --client_port {local_port} "
               f"--time {TEST_DURATION} --msg-size 64 --mps {MPS} "
               f"--pre-warmup-wait {PRE_WARM_WAIT}")
    else:  # bandwidth
        print(f"  - Running {test_type} bandwidth test...")
        cmd = (f"sockperf throughput -i {remote_ip} -p {remote_port} "
               f"--client_ip {local_ip} --client_port {local_port} "
               f"--time {TEST_DURATION} --msg-size 1472 "
               f"--pre-warmup-wait {PRE_WARM_WAIT}")
    
    debug_print(f"Running command: {cmd}", debug)
    
    try:
        result = subprocess.run(cmd, shell=True, stdout=open(output_file, 'w'), stderr=subprocess.STDOUT)
        
        if result.returncode != 0:
            print(f"ERROR: UDP sockperf {test_mode} command failed for {test_type} test.")
            print("Command output:")
            with open(output_file, 'r') as f:
                print(f.read())
            return False
        
        # Add metadata to the beginning of the output file
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(output_file, 'r') as f:
            content = f.read()
        
        with open(output_file, 'w') as f:
            f.write(f"# 5-Tuple: {five_tuple}\n")
            f.write(f"# Test type: {test_type}\n")
            f.write(f"# Test mode: {test_mode}\n")
            f.write(f"# Iteration: {iteration}, Repeat: {repeat}\n")
            f.write(f"# Timestamp: {timestamp}\n")
            f.write("#----------------------------------------------------\n")
            f.write(content)
        
        return True
    except Exception as e:
        print(f"Error running sockperf test: {e}")
        return False

def extract_metrics(latency_file: str, bandwidth_file: str, five_tuple: str, debug: bool = False) -> Dict[str, str]:
    """Extract metrics from sockperf output files."""
    metrics = {
        "five_tuple": five_tuple,
        "avg_latency": "N/A",
        "min_latency": "N/A",
        "max_latency": "N/A",
        "percentile_50": "N/A",
        "percentile_99": "N/A",
        "percentile_999": "N/A",
        "bandwidth_gbps": "N/A",
        "message_rate": "N/A"
    }
    
    # Extract latency metrics
    if os.path.exists(latency_file):
        debug_print(f"Extracting metrics from {latency_file}", debug)
        
        with open(latency_file, 'r') as f:
            content = f.read()
            
            # Try multiple patterns for average latency
            avg_patterns = [
                r"avg-lat=([0-9.]+)",
                r"Summary: Latency is ([0-9.]+)",
                r"Average latency.*: ([0-9.]+)",
                r"avg.*latency.*: ([0-9.]+)",
                r"average.*: ([0-9.]+)",
                r"latency average: ([0-9.]+)",
                r"average = ([0-9.]+)"
            ]
            
            for pattern in avg_patterns:
                avg_match = re.search(pattern, content)
                if avg_match:
                    metrics["avg_latency"] = avg_match.group(1)
                    break
            
            # Try multiple patterns for min latency
            min_patterns = [
                r"min-lat=([0-9.]+)",
                r"<MIN> observation = ([0-9.]+)",
                r"Min latency = ([0-9.]+)"
            ]
            
            for pattern in min_patterns:
                min_match = re.search(pattern, content)
                if min_match:
                    metrics["min_latency"] = min_match.group(1)
                    break
            
            # Try multiple patterns for max latency
            max_patterns = [
                r"max-lat=([0-9.]+)",
                r"<MAX> observation = ([0-9.]+)",
                r"Max latency = ([0-9.]+)",
                r"---> <MAX> observation = ([0-9.]+)"
            ]
            
            for pattern in max_patterns:
                max_match = re.search(pattern, content)
                if max_match:
                    metrics["max_latency"] = max_match.group(1)
                    break
            
            # Try multiple patterns for p50 latency
            p50_patterns = [
                r"median-lat=([0-9.]+)",
                r"percentile 50\.00.? = ([0-9.]+)",
                r"percentile 50.? = ([0-9.]+)",
                r"---> percentile 50\.000 = ([0-9.]+)",
                r"---> percentile 50\.00 = ([0-9.]+)",
                r"---> percentile 50\.0 = ([0-9.]+)",
                r"---> percentile 50 = ([0-9.]+)"
            ]
            
            for pattern in p50_patterns:
                p50_match = re.search(pattern, content)
                if p50_match:
                    metrics["percentile_50"] = p50_match.group(1)
                    break
                
            # If we still don't have p50, try to find it in the percentile section
            if metrics["percentile_50"] == "N/A":
                percentile_section = re.search(r"Total \d+ observations.*?---> <MIN>.*?---> <MAX>", content, re.DOTALL)
                if percentile_section:
                    section_text = percentile_section.group(0)
                    p50_match = re.search(r"---> percentile 50[\.0]* = ([0-9.]+)", section_text)
                    if p50_match:
                        metrics["percentile_50"] = p50_match.group(1)
            
            # Try multiple patterns for p99 latency
            p99_patterns = [
                r"percentile 99\.00.? = ([0-9.]+)",
                r"percentile 99.? = ([0-9.]+)",
                r"---> percentile 99\.000 = ([0-9.]+)",
                r"---> percentile 99\.00 = ([0-9.]+)",
                r"---> percentile 99\.0 = ([0-9.]+)",
                r"---> percentile 99 = ([0-9.]+)"
            ]
            
            for pattern in p99_patterns:
                p99_match = re.search(pattern, content)
                if p99_match:
                    metrics["percentile_99"] = p99_match.group(1)
                    break
                
            # If we still don't have p99, try to find it in the percentile section
            if metrics["percentile_99"] == "N/A":
                percentile_section = re.search(r"Total \d+ observations.*?---> <MIN>.*?---> <MAX>", content, re.DOTALL)
                if percentile_section:
                    section_text = percentile_section.group(0)
                    p99_match = re.search(r"---> percentile 99[\.0]* = ([0-9.]+)", section_text)
                    if p99_match:
                        metrics["percentile_99"] = p99_match.group(1)
            
            # Try multiple patterns for p99.9 latency
            p999_patterns = [
                r"percentile 99\.90.? = ([0-9.]+)",
                r"percentile 99\.9.? = ([0-9.]+)",
                r"---> percentile 99\.900 = ([0-9.]+)",
                r"---> percentile 99\.90 = ([0-9.]+)",
                r"---> percentile 99\.9 = ([0-9.]+)"
            ]
            
            for pattern in p999_patterns:
                p999_match = re.search(pattern, content)
                if p999_match:
                    metrics["percentile_999"] = p999_match.group(1)
                    break
                
            # If we still don't have p99.9, try to find it in the percentile section
            if metrics["percentile_999"] == "N/A":
                percentile_section = re.search(r"Total \d+ observations.*?---> <MIN>.*?---> <MAX>", content, re.DOTALL)
                if percentile_section:
                    section_text = percentile_section.group(0)
                    p999_match = re.search(r"---> percentile 99\.9[0]* = ([0-9.]+)", section_text)
                    if p999_match:
                        metrics["percentile_999"] = p999_match.group(1)
                    
            # If we still don't have metrics, print some debug info
            if debug and metrics["avg_latency"] == "N/A":
                print(f"DEBUG: Could not extract metrics from {latency_file}")
                print(f"DEBUG: First 100 characters of content: {content[:100]}")
                print(f"DEBUG: File size: {os.path.getsize(latency_file)} bytes")
    
    # Extract bandwidth metrics
    if os.path.exists(bandwidth_file):
        debug_print(f"Extracting metrics from {bandwidth_file}", debug)
        
        with open(bandwidth_file, 'r') as f:
            content = f.read()
            
            # Extract message rate
            msg_rate_match = re.search(r"Message Rate is ([0-9.]+)", content)
            if msg_rate_match:
                metrics["message_rate"] = msg_rate_match.group(1)
            
            # Extract bandwidth
            bw_patterns = [
                r"Throughput: ([0-9.]+)",
                r"BandWidth is [0-9.]+ MBps \(([0-9.]+) Mbps\)"
            ]
            
            for pattern in bw_patterns:
                bw_match = re.search(pattern, content)
                if bw_match:
                    bandwidth_mbps = float(bw_match.group(1))
                    metrics["bandwidth_gbps"] = f"{bandwidth_mbps / 1000:.3f}"
                    break
    
    return metrics

def calculate_improvement(eni_value: str, srd_value: str) -> str:
    """Calculate improvement percentage between ENI and SRD values."""
    if eni_value == "N/A" or srd_value == "N/A":
        return "N/A"
    
    try:
        eni_float = float(eni_value)
        srd_float = float(srd_value)
        
        if eni_float <= 0:
            return "N/A"
        
        # For latency metrics, improvement is (ENI - SRD) / ENI * 100
        # For bandwidth metrics, improvement is (SRD - ENI) / ENI * 100
        improvement = ((eni_float - srd_float) / eni_float) * 100
        return f"{improvement:.2f}"
    except (ValueError, ZeroDivisionError):
        return "N/A"

def calculate_bandwidth_improvement(eni_value: str, srd_value: str) -> str:
    """Calculate bandwidth improvement percentage between ENI and SRD values."""
    if eni_value == "N/A" or srd_value == "N/A":
        return "N/A"
    
    try:
        eni_float = float(eni_value)
        srd_float = float(srd_value)
        
        if eni_float <= 0:
            return "N/A"
        
        # For bandwidth metrics, improvement is (SRD - ENI) / ENI * 100
        improvement = ((srd_float - eni_float) / eni_float) * 100
        return f"{improvement:.2f}"
    except (ValueError, ZeroDivisionError):
        return "N/A"

def format_table_row(columns: List[str], widths: List[int], colors: List[str] = None) -> str:
    """Format a row in the table with proper alignment and colors."""
    if colors is None:
        colors = [Colors.ENDC] * len(columns)
    
    row = "│ "
    for i, (col, width, color) in enumerate(zip(columns, widths, colors)):
        row += f"{color}{col}{Colors.ENDC}".ljust(width + len(Colors.ENDC)) + " │ "
    
    return row

def format_table_header(title: str, width: int) -> List[str]:
    """Format the table header with title."""
    header = []
    header.append("┌" + "─" * (width - 2) + "┐")
    header.append("│" + f"{Colors.BOLD}{title.center(width - 2)}{Colors.ENDC}" + "│")
    header.append("├" + "─" * (width - 2) + "┤")
    return header

def format_table_section(title: str, width: int) -> List[str]:
    """Format a section header in the table."""
    section = []
    section.append("├" + "─" * (width - 2) + "┤")
    section.append("│" + f"{Colors.BOLD}{title.center(width - 2)}{Colors.ENDC}" + "│")
    section.append("├" + "─" * (width - 2) + "┤")
    return section

def format_table_footer(width: int) -> str:
    """Format the table footer."""
    return "└" + "─" * (width - 2) + "┘"

def run_tests(debug: bool = False) -> Dict:
    """Run all tests and return the results."""
    # Create output directories
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = f"sockperf_results_{timestamp}"
    os.makedirs(output_dir, exist_ok=True)
    os.makedirs(f"{output_dir}/eni", exist_ok=True)
    os.makedirs(f"{output_dir}/srd", exist_ok=True)
    
    # Create summary files
    eni_summary_file = f"{output_dir}/eni_summary.csv"
    srd_summary_file = f"{output_dir}/srd_summary.csv"
    comparison_file = f"{output_dir}/comparison.csv"
    
    # Write headers to summary files
    with open(eni_summary_file, 'w') as f:
        f.write("Iteration,Repeat,Timestamp,Source_IP,Source_Port,Dest_IP,Dest_Port,Protocol,MPS,Avg_Latency_usec,Min_Latency_usec,Max_Latency_usec,Percentile_50th,Percentile_99th,Percentile_99.9th,Bandwidth_Gbps,Message_Rate\n")
    
    with open(srd_summary_file, 'w') as f:
        f.write("Iteration,Repeat,Timestamp,Source_IP,Source_Port,Dest_IP,Dest_Port,Protocol,MPS,Avg_Latency_usec,Min_Latency_usec,Max_Latency_usec,Percentile_50th,Percentile_99th,Percentile_99.9th,Bandwidth_Gbps,Message_Rate\n")
    
    with open(comparison_file, 'w') as f:
        f.write("Iteration,Repeat,Timestamp,Protocol,ENI_5Tuple,SRD_5Tuple,ENI_Avg,SRD_Avg,ENI_p50,SRD_p50,ENI_p99,SRD_p99,ENI_Max,SRD_Max,Improvement_Avg_Percent,Improvement_p50_Percent,Improvement_p99_Percent,Improvement_Max_Percent,ENI_BW,SRD_BW,BW_Improvement_Percent\n")
    
    # Check if sockperf servers are running
    if not check_sockperf_server(SERVER_IP_ENI, SERVER_PORT_ENI, "ENI", debug):
        return {"error": "ENI sockperf server not running"}
    
    if not check_sockperf_server(SERVER_IP_SRD, SERVER_PORT_SRD, "SRD", debug):
        return {"error": "SRD sockperf server not running"}
    
    # Record test start time
    test_start_time = datetime.datetime.now()
    print("=" * 72)
    print(f"Test started at: {test_start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 72)
    
    all_results = []
    
    # Main test loop
    for i in range(ITERATIONS):
        for j in range(REPEAT):
            print(f"===== Starting test iteration {i+1}/{ITERATIONS}, repeat {j+1}/{REPEAT} =====")
            
            # Define output files
            eni_latency_output = f"{output_dir}/eni/iteration_{i}_repeat_{j}_udp_latency.log"
            eni_bandwidth_output = f"{output_dir}/eni/iteration_{i}_repeat_{j}_udp_bandwidth.log"
            srd_latency_output = f"{output_dir}/srd/iteration_{i}_repeat_{j}_udp_latency.log"
            srd_bandwidth_output = f"{output_dir}/srd/iteration_{i}_repeat_{j}_udp_bandwidth.log"
            
            print("Running UDP tests...")
            
            # Run tests in parallel using ThreadPoolExecutor
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
                # Submit all tests
                eni_latency_future = executor.submit(
                    run_sockperf_test, "ENI", "latency", SERVER_IP_ENI, SERVER_PORT_ENI,
                    CLIENT_IP_ENI, CLIENT_PINGPONG_PORT_ENI, eni_latency_output, i, j, debug
                )
                
                eni_bandwidth_future = executor.submit(
                    run_sockperf_test, "ENI", "bandwidth", SERVER_IP_ENI, SERVER_PORT_ENI,
                    CLIENT_IP_ENI, CLIENT_BANDWIDTH_PORT_ENI, eni_bandwidth_output, i, j, debug
                )
                
                srd_latency_future = executor.submit(
                    run_sockperf_test, "SRD", "latency", SERVER_IP_SRD, SERVER_PORT_SRD,
                    CLIENT_IP_SRD, CLIENT_PINGPONG_PORT_SRD, srd_latency_output, i, j, debug
                )
                
                srd_bandwidth_future = executor.submit(
                    run_sockperf_test, "SRD", "bandwidth", SERVER_IP_SRD, SERVER_PORT_SRD,
                    CLIENT_IP_SRD, CLIENT_BANDWIDTH_PORT_SRD, srd_bandwidth_output, i, j, debug
                )
                
                # Wait for all tests to complete
                eni_latency_result = eni_latency_future.result()
                eni_bandwidth_result = eni_bandwidth_future.result()
                srd_latency_result = srd_latency_future.result()
                srd_bandwidth_result = srd_bandwidth_future.result()
            
            # Process test results
            print("Processing UDP test results...")
            
            # Define 5-tuples
            eni_udp_5tuple = f"{CLIENT_IP_ENI}:{CLIENT_PINGPONG_PORT_ENI}->{SERVER_IP_ENI}:{SERVER_PORT_ENI}/UDP"
            srd_udp_5tuple = f"{CLIENT_IP_SRD}:{CLIENT_PINGPONG_PORT_SRD}->{SERVER_IP_SRD}:{SERVER_PORT_SRD}/UDP"
            
            # Extract metrics
            eni_metrics = extract_metrics(eni_latency_output, eni_bandwidth_output, eni_udp_5tuple, debug)
            srd_metrics = extract_metrics(srd_latency_output, srd_bandwidth_output, srd_udp_5tuple, debug)
            
            # Calculate improvement percentages
            avg_improvement = calculate_improvement(eni_metrics["avg_latency"], srd_metrics["avg_latency"])
            p50_improvement = calculate_improvement(eni_metrics["percentile_50"], srd_metrics["percentile_50"])
            p99_improvement = calculate_improvement(eni_metrics["percentile_99"], srd_metrics["percentile_99"])
            max_improvement = calculate_improvement(eni_metrics["max_latency"], srd_metrics["max_latency"])
            bw_improvement = calculate_bandwidth_improvement(eni_metrics["bandwidth_gbps"], srd_metrics["bandwidth_gbps"])
            
            # Format improvement percentages for display
            avg_improvement_display = f"{avg_improvement}%" if avg_improvement != "N/A" else "N/A"
            p50_improvement_display = f"{p50_improvement}%" if p50_improvement != "N/A" else "N/A"
            p99_improvement_display = f"{p99_improvement}%" if p99_improvement != "N/A" else "N/A"
            max_improvement_display = f"{max_improvement}%" if max_improvement != "N/A" else "N/A"
            bw_improvement_display = f"{bw_improvement}%" if bw_improvement != "N/A" else "N/A"
            
            # Log to ENI summary file
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(eni_summary_file, 'a') as f:
                f.write(f"{i},{j},{timestamp},{CLIENT_IP_ENI},{CLIENT_PINGPONG_PORT_ENI},{SERVER_IP_ENI},{SERVER_PORT_ENI},UDP,{MPS},{eni_metrics['avg_latency']},{eni_metrics['min_latency']},{eni_metrics['max_latency']},{eni_metrics['percentile_50']},{eni_metrics['percentile_99']},{eni_metrics['percentile_999']},{eni_metrics['bandwidth_gbps']},{eni_metrics['message_rate']}\n")
            
            # Log to SRD summary file
            with open(srd_summary_file, 'a') as f:
                f.write(f"{i},{j},{timestamp},{CLIENT_IP_SRD},{CLIENT_PINGPONG_PORT_SRD},{SERVER_IP_SRD},{SERVER_PORT_SRD},UDP,{MPS},{srd_metrics['avg_latency']},{srd_metrics['min_latency']},{srd_metrics['max_latency']},{srd_metrics['percentile_50']},{srd_metrics['percentile_99']},{srd_metrics['percentile_999']},{srd_metrics['bandwidth_gbps']},{srd_metrics['message_rate']}\n")
            
            # Log to comparison file
            with open(comparison_file, 'a') as f:
                f.write(f"{i},{j},{timestamp},UDP,\"{eni_udp_5tuple}\",\"{srd_udp_5tuple}\",{eni_metrics['avg_latency']},{srd_metrics['avg_latency']},{eni_metrics['percentile_50']},{srd_metrics['percentile_50']},{eni_metrics['percentile_99']},{srd_metrics['percentile_99']},{eni_metrics['max_latency']},{srd_metrics['max_latency']},{avg_improvement},{p50_improvement},{p99_improvement},{max_improvement},{eni_metrics['bandwidth_gbps']},{srd_metrics['bandwidth_gbps']},{bw_improvement}\n")
            
            # Store results for this iteration
            iteration_result = {
                "iteration": i,
                "repeat": j,
                "timestamp": timestamp,
                "eni_5tuple": eni_udp_5tuple,
                "srd_5tuple": srd_udp_5tuple,
                "eni_avg": eni_metrics["avg_latency"],
                "srd_avg": srd_metrics["avg_latency"],
                "eni_p50": eni_metrics["percentile_50"],
                "srd_p50": srd_metrics["percentile_50"],
                "eni_p99": eni_metrics["percentile_99"],
                "srd_p99": srd_metrics["percentile_99"],
                "eni_max": eni_metrics["max_latency"],
                "srd_max": srd_metrics["max_latency"],
                "avg_improvement": avg_improvement,
                "p50_improvement": p50_improvement,
                "p99_improvement": p99_improvement,
                "max_improvement": max_improvement,
                "eni_bw": eni_metrics["bandwidth_gbps"],
                "srd_bw": srd_metrics["bandwidth_gbps"],
                "bw_improvement": bw_improvement,
                "avg_improvement_display": avg_improvement_display,
                "p50_improvement_display": p50_improvement_display,
                "p99_improvement_display": p99_improvement_display,
                "max_improvement_display": max_improvement_display,
                "bw_improvement_display": bw_improvement_display
            }
            
            all_results.append(iteration_result)
            
            # Print comparison summary
            print("\nUDP Results:")
            print(f"ENI 5-Tuple: {eni_udp_5tuple}")
            print(f"SRD 5-Tuple: {srd_udp_5tuple}")
            print(f"ENI Average: {eni_metrics['avg_latency']} μs | SRD Average: {srd_metrics['avg_latency']} μs | Improvement: {avg_improvement_display}")
            print(f"ENI p50: {eni_metrics['percentile_50']} μs | SRD p50: {srd_metrics['percentile_50']} μs | Improvement: {p50_improvement_display}")
            print(f"ENI p99: {eni_metrics['percentile_99']} μs | SRD p99: {srd_metrics['percentile_99']} μs | Improvement: {p99_improvement_display}")
            print(f"ENI MAX: {eni_metrics['max_latency']} μs | SRD MAX: {srd_metrics['max_latency']} μs | Improvement: {max_improvement_display}")
            print(f"ENI BW: {eni_metrics['bandwidth_gbps']} Gbps | SRD BW: {srd_metrics['bandwidth_gbps']} Gbps | Improvement: {bw_improvement_display}")
            print("-" * 53)
            
            # Optional delay between repeats
            if j < REPEAT - 1:
                print("Waiting 10 seconds before next repeat...")
                time.sleep(10)
        
        # Optional delay between iterations
        if i < ITERATIONS - 1:
            print("Waiting 30 seconds before next iteration...")
            time.sleep(30)
    
    # Record test end time
    test_end_time = datetime.datetime.now()
    print("=" * 72)
    print(f"Test ended at: {test_end_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 72)
    
    # Generate summary report
    print("Tests completed. Generating summary report...")
    
    # Calculate averages from all results
    if all_results:
        udp_eni_avg = sum(float(r["eni_avg"]) for r in all_results if r["eni_avg"] != "N/A") / len(all_results)
        udp_srd_avg = sum(float(r["srd_avg"]) for r in all_results if r["srd_avg"] != "N/A") / len(all_results)
        udp_eni_p50 = sum(float(r["eni_p50"]) for r in all_results if r["eni_p50"] != "N/A") / len(all_results)
        udp_srd_p50 = sum(float(r["srd_p50"]) for r in all_results if r["srd_p50"] != "N/A") / len(all_results)
        udp_eni_p99 = sum(float(r["eni_p99"]) for r in all_results if r["eni_p99"] != "N/A") / len(all_results)
        udp_srd_p99 = sum(float(r["srd_p99"]) for r in all_results if r["srd_p99"] != "N/A") / len(all_results)
        udp_eni_max = sum(float(r["eni_max"]) for r in all_results if r["eni_max"] != "N/A") / len(all_results)
        udp_srd_max = sum(float(r["srd_max"]) for r in all_results if r["srd_max"] != "N/A") / len(all_results)
        udp_eni_bw = sum(float(r["eni_bw"]) for r in all_results if r["eni_bw"] != "N/A") / len(all_results)
        udp_srd_bw = sum(float(r["srd_bw"]) for r in all_results if r["srd_bw"] != "N/A") / len(all_results)
        
        # Calculate overall improvement percentages
        udp_avg_improvement = ((udp_eni_avg - udp_srd_avg) / udp_eni_avg) * 100 if udp_eni_avg > 0 else 0
        udp_p50_improvement = ((udp_eni_p50 - udp_srd_p50) / udp_eni_p50) * 100 if udp_eni_p50 > 0 else 0
        udp_p99_improvement = ((udp_eni_p99 - udp_srd_p99) / udp_eni_p99) * 100 if udp_eni_p99 > 0 else 0
        udp_max_improvement = ((udp_eni_max - udp_srd_max) / udp_eni_max) * 100 if udp_eni_max > 0 else 0
        udp_bw_improvement = ((udp_srd_bw - udp_eni_bw) / udp_eni_bw) * 100 if udp_eni_bw > 0 else 0
        
        # Format for display
        udp_avg_improvement_display = f"{udp_avg_improvement:.2f}%"
        udp_p50_improvement_display = f"{udp_p50_improvement:.2f}%"
        udp_p99_improvement_display = f"{udp_p99_improvement:.2f}%"
        udp_max_improvement_display = f"{udp_max_improvement:.2f}%"
        udp_bw_improvement_display = f"{udp_bw_improvement:.2f}%"
    else:
        udp_eni_avg = udp_srd_avg = udp_eni_p50 = udp_srd_p50 = 0
        udp_eni_p99 = udp_srd_p99 = udp_eni_max = udp_srd_max = 0
        udp_eni_bw = udp_srd_bw = 0
        udp_avg_improvement_display = udp_p50_improvement_display = "N/A"
        udp_p99_improvement_display = udp_max_improvement_display = "N/A"
        udp_bw_improvement_display = "N/A"
    
    # Create summary report
    summary_report = f"{output_dir}/summary_report.txt"
    
    # Create a pretty table for the summary report
    table_width = 72
    
    with open(summary_report, 'w') as f:
        # Write header
        header_lines = format_table_header("ENA vs ENA Express Performance Summary", table_width)
        for line in header_lines:
            f.write(f"{line}\n")
            print(line)
        
        # Write test information
        f.write(f"│ Test Date: {datetime.datetime.now().strftime('%a %b %d %H:%M:%S %Z %Y')}{' ' * (table_width - 45)}│\n")
        f.write(f"│ Test Start Time: {test_start_time.strftime('%Y-%m-%d %H:%M:%S')}{' ' * (table_width - 47)}│\n")
        f.write(f"│ Test End Time: {test_end_time.strftime('%Y-%m-%d %H:%M:%S')}{' ' * (table_width - 45)}│\n")
        f.write(f"│ Total Iterations: {ITERATIONS}{' ' * (table_width - 22 - len(str(ITERATIONS)))}│\n")
        f.write(f"│ Repeats per Iteration: {REPEAT}{' ' * (table_width - 26 - len(str(REPEAT)))}│\n")
        f.write(f"│ Total Tests: {ITERATIONS * REPEAT}{' ' * (table_width - 16 - len(str(ITERATIONS * REPEAT)))}│\n")
        
        print(f"│ Test Date: {datetime.datetime.now().strftime('%a %b %d %H:%M:%S %Z %Y')}{' ' * (table_width - 45)}│")
        print(f"│ Test Start Time: {test_start_time.strftime('%Y-%m-%d %H:%M:%S')}{' ' * (table_width - 47)}│")
        print(f"│ Test End Time: {test_end_time.strftime('%Y-%m-%d %H:%M:%S')}{' ' * (table_width - 45)}│")
        print(f"│ Total Iterations: {ITERATIONS}{' ' * (table_width - 22 - len(str(ITERATIONS)))}│")
        print(f"│ Repeats per Iteration: {REPEAT}{' ' * (table_width - 26 - len(str(REPEAT)))}│")
        print(f"│ Total Tests: {ITERATIONS * REPEAT}{' ' * (table_width - 16 - len(str(ITERATIONS * REPEAT)))}│")
        
        # Write connection details section
        section_lines = format_table_section("Connection Details", table_width)
        for line in section_lines:
            f.write(f"{line}\n")
            print(line)
        
        f.write(f"│ Regular ENI:{' ' * (table_width - 14)}│\n")
        f.write(f"│   Source IP: {CLIENT_IP_ENI}{' ' * (table_width - 15 - len(CLIENT_IP_ENI))}│\n")
        f.write(f"│   Destination IP: {SERVER_IP_ENI}{' ' * (table_width - 20 - len(SERVER_IP_ENI))}│\n")
        f.write(f"│{' ' * (table_width - 2)}│\n")
        f.write(f"│ ENA Express:{' ' * (table_width - 14)}│\n")
        f.write(f"│   Source IP: {CLIENT_IP_SRD}{' ' * (table_width - 15 - len(CLIENT_IP_SRD))}│\n")
        f.write(f"│   Destination IP: {SERVER_IP_SRD}{' ' * (table_width - 20 - len(SERVER_IP_SRD))}│\n")
        
        print(f"│ Regular ENI:{' ' * (table_width - 14)}│")
        print(f"│   Source IP: {CLIENT_IP_ENI}{' ' * (table_width - 15 - len(CLIENT_IP_ENI))}│")
        print(f"│   Destination IP: {SERVER_IP_ENI}{' ' * (table_width - 20 - len(SERVER_IP_ENI))}│")
        print(f"│{' ' * (table_width - 2)}│")
        print(f"│ ENA Express:{' ' * (table_width - 14)}│")
        print(f"│   Source IP: {CLIENT_IP_SRD}{' ' * (table_width - 15 - len(CLIENT_IP_SRD))}│")
        print(f"│   Destination IP: {SERVER_IP_SRD}{' ' * (table_width - 20 - len(SERVER_IP_SRD))}│")
        
        # Write UDP Ping-Pong (Latency) Results section
        section_lines = format_table_section("UDP Ping-Pong (Latency) Results", table_width)
        for line in section_lines:
            f.write(f"{line}\n")
            print(line)
        
        # Format UDP latency results with colors based on improvement
        # For latency metrics, negative improvement (red) is bad, positive (green) is good
        
        # Average Latency
        f.write(f"│ Average Latency:{' ' * (table_width - 18)}│\n")
        f.write(f"│   Regular ENI: {udp_eni_avg:.3f} μs{' ' * (table_width - 22 - len(f'{udp_eni_avg:.3f}'))}│\n")
        f.write(f"│   ENA Express: {udp_srd_avg:.3f} μs{' ' * (table_width - 22 - len(f'{udp_srd_avg:.3f}'))}│\n")
        
        if udp_avg_improvement >= 0:
            improvement_color = Colors.GREEN
        else:
            improvement_color = Colors.RED
        
        f.write(f"│   Improvement: {improvement_color}{udp_avg_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_avg_improvement_display))}│\n")
        f.write(f"│{' ' * (table_width - 2)}│\n")
        
        print(f"│ Average Latency:{' ' * (table_width - 18)}│")
        print(f"│   Regular ENI: {udp_eni_avg:.3f} μs{' ' * (table_width - 22 - len(f'{udp_eni_avg:.3f}'))}│")
        print(f"│   ENA Express: {udp_srd_avg:.3f} μs{' ' * (table_width - 22 - len(f'{udp_srd_avg:.3f}'))}│")
        
        if udp_avg_improvement >= 0:
            print(f"│   Improvement: {Colors.GREEN}{udp_avg_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_avg_improvement_display))}│")
        else:
            print(f"│   Improvement: {Colors.RED}{udp_avg_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_avg_improvement_display))}│")
        
        print(f"│{' ' * (table_width - 2)}│")
        
        # p50 Latency
        f.write(f"│ p50 Latency:{' ' * (table_width - 14)}│\n")
        f.write(f"│   Regular ENI: {udp_eni_p50:.3f} μs{' ' * (table_width - 22 - len(f'{udp_eni_p50:.3f}'))}│\n")
        f.write(f"│   ENA Express: {udp_srd_p50:.3f} μs{' ' * (table_width - 22 - len(f'{udp_srd_p50:.3f}'))}│\n")
        
        if udp_p50_improvement >= 0:
            improvement_color = Colors.GREEN
        else:
            improvement_color = Colors.RED
        
        f.write(f"│   Improvement: {improvement_color}{udp_p50_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_p50_improvement_display))}│\n")
        f.write(f"│{' ' * (table_width - 2)}│\n")
        
        print(f"│ p50 Latency:{' ' * (table_width - 14)}│")
        print(f"│   Regular ENI: {udp_eni_p50:.3f} μs{' ' * (table_width - 22 - len(f'{udp_eni_p50:.3f}'))}│")
        print(f"│   ENA Express: {udp_srd_p50:.3f} μs{' ' * (table_width - 22 - len(f'{udp_srd_p50:.3f}'))}│")
        
        if udp_p50_improvement >= 0:
            print(f"│   Improvement: {Colors.GREEN}{udp_p50_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_p50_improvement_display))}│")
        else:
            print(f"│   Improvement: {Colors.RED}{udp_p50_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_p50_improvement_display))}│")
        
        print(f"│{' ' * (table_width - 2)}│")
        
        # p99 Latency
        f.write(f"│ p99 Latency:{' ' * (table_width - 14)}│\n")
        f.write(f"│   Regular ENI: {udp_eni_p99:.3f} μs{' ' * (table_width - 22 - len(f'{udp_eni_p99:.3f}'))}│\n")
        f.write(f"│   ENA Express: {udp_srd_p99:.3f} μs{' ' * (table_width - 22 - len(f'{udp_srd_p99:.3f}'))}│\n")
        
        if udp_p99_improvement >= 0:
            improvement_color = Colors.GREEN
        else:
            improvement_color = Colors.RED
        
        f.write(f"│   Improvement: {improvement_color}{udp_p99_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_p99_improvement_display))}│\n")
        f.write(f"│{' ' * (table_width - 2)}│\n")
        
        print(f"│ p99 Latency:{' ' * (table_width - 14)}│")
        print(f"│   Regular ENI: {udp_eni_p99:.3f} μs{' ' * (table_width - 22 - len(f'{udp_eni_p99:.3f}'))}│")
        print(f"│   ENA Express: {udp_srd_p99:.3f} μs{' ' * (table_width - 22 - len(f'{udp_srd_p99:.3f}'))}│")
        
        if udp_p99_improvement >= 0:
            print(f"│   Improvement: {Colors.GREEN}{udp_p99_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_p99_improvement_display))}│")
        else:
            print(f"│   Improvement: {Colors.RED}{udp_p99_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_p99_improvement_display))}│")
        
        print(f"│{' ' * (table_width - 2)}│")
        
        # Maximum Latency
        f.write(f"│ Maximum Latency:{' ' * (table_width - 18)}│\n")
        f.write(f"│   Regular ENI: {udp_eni_max:.3f} μs{' ' * (table_width - 22 - len(f'{udp_eni_max:.3f}'))}│\n")
        f.write(f"│   ENA Express: {udp_srd_max:.3f} μs{' ' * (table_width - 22 - len(f'{udp_srd_max:.3f}'))}│\n")
        
        if udp_max_improvement >= 0:
            improvement_color = Colors.GREEN
        else:
            improvement_color = Colors.RED
        
        f.write(f"│   Improvement: {improvement_color}{udp_max_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_max_improvement_display))}│\n")
        
        print(f"│ Maximum Latency:{' ' * (table_width - 18)}│")
        print(f"│   Regular ENI: {udp_eni_max:.3f} μs{' ' * (table_width - 22 - len(f'{udp_eni_max:.3f}'))}│")
        print(f"│   ENA Express: {udp_srd_max:.3f} μs{' ' * (table_width - 22 - len(f'{udp_srd_max:.3f}'))}│")
        
        if udp_max_improvement >= 0:
            print(f"│   Improvement: {Colors.GREEN}{udp_max_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_max_improvement_display))}│")
        else:
            print(f"│   Improvement: {Colors.RED}{udp_max_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_max_improvement_display))}│")
        
        # Write UDP Throughput (Bandwidth) Results section
        section_lines = format_table_section("UDP Throughput (Bandwidth) Results", table_width)
        for line in section_lines:
            f.write(f"{line}\n")
            print(line)
        
        # Format UDP bandwidth results with colors based on improvement
        # For bandwidth metrics, negative improvement (red) is bad, positive (green) is good
        
        # Bandwidth
        f.write(f"│ Bandwidth:{' ' * (table_width - 12)}│\n")
        f.write(f"│   Regular ENI: {udp_eni_bw:.3f} Gbps{' ' * (table_width - 24 - len(f'{udp_eni_bw:.3f}'))}│\n")
        f.write(f"│   ENA Express: {udp_srd_bw:.3f} Gbps{' ' * (table_width - 24 - len(f'{udp_srd_bw:.3f}'))}│\n")
        
        if udp_bw_improvement >= 0:
            improvement_color = Colors.GREEN
        else:
            improvement_color = Colors.RED
        
        f.write(f"│   Improvement: {improvement_color}{udp_bw_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_bw_improvement_display))}│\n")
        f.write(f"│{' ' * (table_width - 2)}│\n")
        
        print(f"│ Bandwidth:{' ' * (table_width - 12)}│")
        print(f"│   Regular ENI: {udp_eni_bw:.3f} Gbps{' ' * (table_width - 24 - len(f'{udp_eni_bw:.3f}'))}│")
        print(f"│   ENA Express: {udp_srd_bw:.3f} Gbps{' ' * (table_width - 24 - len(f'{udp_srd_bw:.3f}'))}│")
        
        if udp_bw_improvement >= 0:
            print(f"│   Improvement: {Colors.GREEN}{udp_bw_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_bw_improvement_display))}│")
        else:
            print(f"│   Improvement: {Colors.RED}{udp_bw_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(udp_bw_improvement_display))}│")
        
        # Message Rate
        f.write(f"│ Message Rate:{' ' * (table_width - 15)}│\n")
        f.write(f"│   Regular ENI: {eni_metrics['message_rate']} msg/sec{' ' * (table_width - 28 - len(eni_metrics['message_rate']))}│\n")
        f.write(f"│   ENA Express: {srd_metrics['message_rate']} msg/sec{' ' * (table_width - 28 - len(srd_metrics['message_rate']))}│\n")
        
        # Calculate message rate improvement
        if eni_metrics['message_rate'] != "N/A" and srd_metrics['message_rate'] != "N/A":
            try:
                eni_mr = float(eni_metrics['message_rate'])
                srd_mr = float(srd_metrics['message_rate'])
                if eni_mr > 0:
                    mr_improvement = ((srd_mr - eni_mr) / eni_mr) * 100
                    mr_improvement_display = f"{mr_improvement:.2f}%"
                    if mr_improvement >= 0:
                        mr_improvement_color = Colors.GREEN
                    else:
                        mr_improvement_color = Colors.RED
                else:
                    mr_improvement_display = "N/A"
                    mr_improvement_color = Colors.ENDC
            except (ValueError, ZeroDivisionError):
                mr_improvement_display = "N/A"
                mr_improvement_color = Colors.ENDC
        else:
            mr_improvement_display = "N/A"
            mr_improvement_color = Colors.ENDC
        
        f.write(f"│   Improvement: {mr_improvement_color}{mr_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(mr_improvement_display))}│\n")
        
        print(f"│ Message Rate:{' ' * (table_width - 15)}│")
        print(f"│   Regular ENI: {eni_metrics['message_rate']} msg/sec{' ' * (table_width - 28 - len(eni_metrics['message_rate']))}│")
        print(f"│   ENA Express: {srd_metrics['message_rate']} msg/sec{' ' * (table_width - 28 - len(srd_metrics['message_rate']))}│")
        print(f"│   Improvement: {mr_improvement_color}{mr_improvement_display}{Colors.ENDC}{' ' * (table_width - 16 - len(mr_improvement_display))}│")
        
        # Write footer
        footer = format_table_section(f"Results saved in: {output_dir}", table_width)
        for line in footer[:-1]:  # Skip the last line which is a section separator
            f.write(f"{line}\n")
            print(line)
        
        # Write final footer
        f.write(f"{format_table_footer(table_width)}\n")
        print(format_table_footer(table_width))
    
    # Create a 5-tuple summary file
    tuple_summary = f"{output_dir}/5tuple_summary.txt"
    
    with open(tuple_summary, 'w') as f:
        # Write header
        header_lines = format_table_header("5-Tuple Connection Details", table_width)
        for line in header_lines:
            f.write(f"{line}\n")
        
        # Write Regular ENI UDP details
        f.write(f"│ Regular ENI UDP:{' ' * (table_width - 18)}│\n")
        f.write(f"│   Source IP: {CLIENT_IP_ENI}{' ' * (table_width - 15 - len(CLIENT_IP_ENI))}│\n")
        f.write(f"│   Source Port (Latency): {CLIENT_PINGPONG_PORT_ENI}{' ' * (table_width - 27 - len(str(CLIENT_PINGPONG_PORT_ENI)))}│\n")
        f.write(f"│   Source Port (Bandwidth): {CLIENT_BANDWIDTH_PORT_ENI}{' ' * (table_width - 30 - len(str(CLIENT_BANDWIDTH_PORT_ENI)))}│\n")
        f.write(f"│   Destination IP: {SERVER_IP_ENI}{' ' * (table_width - 20 - len(SERVER_IP_ENI))}│\n")
        f.write(f"│   Destination Port: {SERVER_PORT_ENI}{' ' * (table_width - 22 - len(str(SERVER_PORT_ENI)))}│\n")
        f.write(f"│   Protocol: UDP{' ' * (table_width - 16)}│\n")
        f.write(f"│{' ' * (table_width - 2)}│\n")
        
        # Write ENA Express UDP details
        f.write(f"│ ENA Express UDP:{' ' * (table_width - 18)}│\n")
        f.write(f"│   Source IP: {CLIENT_IP_SRD}{' ' * (table_width - 15 - len(CLIENT_IP_SRD))}│\n")
        f.write(f"│   Source Port (Latency): {CLIENT_PINGPONG_PORT_SRD}{' ' * (table_width - 27 - len(str(CLIENT_PINGPONG_PORT_SRD)))}│\n")
        f.write(f"│   Source Port (Bandwidth): {CLIENT_BANDWIDTH_PORT_SRD}{' ' * (table_width - 30 - len(str(CLIENT_BANDWIDTH_PORT_SRD)))}│\n")
        f.write(f"│   Destination IP: {SERVER_IP_SRD}{' ' * (table_width - 20 - len(SERVER_IP_SRD))}│\n")
        f.write(f"│   Destination Port: {SERVER_PORT_SRD}{' ' * (table_width - 22 - len(str(SERVER_PORT_SRD)))}│\n")
        f.write(f"│   Protocol: UDP{' ' * (table_width - 16)}│\n")
        
        # Write footer
        footer = format_table_section("Note: Each test uses fixed source ports", table_width)
        for line in footer[:-1]:  # Skip the last line which is a section separator
            f.write(f"{line}\n")
        
        # Write final footer
        f.write(f"{format_table_footer(table_width)}\n")
    
    print("\n5-Tuple Connection Details:")
    with open(tuple_summary, 'r') as f:
        print(f.read())
    
    print("Test completed successfully!")
    
    return {
        "output_dir": output_dir,
        "summary_report": summary_report,
        "tuple_summary": tuple_summary,
        "all_results": all_results
    }

def main():
    """Main function to parse arguments and run tests."""
    # Declare globals at the beginning of the function
    global ITERATIONS, REPEAT, TEST_DURATION, PRE_WARM_WAIT, MPS
    
    parser = argparse.ArgumentParser(description="ENA Express Latency Benchmark")
    parser.add_argument("--debug", action="store_true", help="Enable debug output")
    parser.add_argument("--iterations", type=int, default=ITERATIONS, help=f"Number of test iterations (default: {ITERATIONS})")
    parser.add_argument("--repeat", type=int, default=REPEAT, help=f"Number of repeats per iteration (default: {REPEAT})")
    parser.add_argument("--duration", type=int, default=TEST_DURATION, help=f"Test duration in seconds (default: {TEST_DURATION})")
    parser.add_argument("--pre-warm-wait", type=int, default=PRE_WARM_WAIT, help=f"Pre-warmup wait time in seconds (default: {PRE_WARM_WAIT})")
    parser.add_argument("--mps", default=MPS, help=f"Messages per second (default: {MPS})")
    
    args = parser.parse_args()
    
    # Update global variables with command line arguments
    ITERATIONS = args.iterations
    REPEAT = args.repeat
    TEST_DURATION = args.duration
    PRE_WARM_WAIT = args.pre_warm_wait
    MPS = args.mps
    
    # Run tests
    run_tests(args.debug)

if __name__ == "__main__":
    main()
