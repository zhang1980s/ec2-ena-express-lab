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

# Test parameters
ITERATIONS = 1
REPEAT = 1
TEST_DURATION = 30  # Test duration in seconds
PRE_WARM_WAIT = 3   # Pre-warmup wait time in seconds
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

def run_sockperf_test(test_type: str, remote_ip: str, remote_port: int, 
                     local_ip: str, local_port: int, output_file: str, iteration: int, 
                     repeat: int, debug: bool = False) -> bool:
    """Run a sockperf latency test with the specified parameters."""
    five_tuple = f"{local_ip}:{local_port}->{remote_ip}:{remote_port}/UDP"
    
    print(f"  - Running {test_type} latency test...")
    cmd = (f"sockperf ping-pong -i {remote_ip} -p {remote_port} "
           f"--client_ip {local_ip} --client_port {local_port} "
           f"--time {TEST_DURATION} --msg-size 64 --mps {MPS} "
           f"--pre-warmup-wait {PRE_WARM_WAIT}")
    
    debug_print(f"Running command: {cmd}", debug)
    
    try:
        result = subprocess.run(cmd, shell=True, stdout=open(output_file, 'w'), stderr=subprocess.STDOUT)
        
        if result.returncode != 0:
            print(f"ERROR: UDP sockperf latency command failed for {test_type} test.")
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
            f.write(f"# Test mode: latency\n")
            f.write(f"# Iteration: {iteration}, Repeat: {repeat}\n")
            f.write(f"# Timestamp: {timestamp}\n")
            f.write("#----------------------------------------------------\n")
            f.write(content)
        
        return True
    except Exception as e:
        print(f"Error running sockperf test: {e}")
        return False

def extract_metrics_from_file(file_path):
    """Extract metrics directly from the sockperf output file."""
    metrics = {}
    
    if not os.path.exists(file_path):
        return metrics
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Extract runtime, sent messages, received messages
    valid_duration = re.search(r"\[Valid Duration\] RunTime=([0-9.]+) sec; SentMessages=([0-9]+); ReceivedMessages=([0-9]+)", content)
    if valid_duration:
        metrics["runtime"] = valid_duration.group(1)
        metrics["sent_messages"] = valid_duration.group(2)
        metrics["received_messages"] = valid_duration.group(3)
    
    # Extract dropped, duplicated, out-of-order messages
    messages = re.search(r"# dropped messages = ([0-9]+); # duplicated messages = ([0-9]+); # out-of-order messages = ([0-9]+)", content)
    if messages:
        metrics["dropped_messages"] = messages.group(1)
        metrics["duplicated_messages"] = messages.group(2)
        metrics["out_of_order_messages"] = messages.group(3)
    
    # Extract avg-latency and related stats
    stats = re.search(r"avg-latency=([0-9.]+) \(std-dev=([0-9.]+), mean-ad=([0-9.]+), median-ad=([0-9.]+), siqr=([0-9.]+), cv=([0-9.]+), std-error=([0-9.]+)", content)
    if stats:
        metrics["avg_latency"] = stats.group(1)
        metrics["std_dev"] = stats.group(2)
        metrics["mean_ad"] = stats.group(3)
        metrics["median_ad"] = stats.group(4)
        metrics["siqr"] = stats.group(5)
        metrics["cv"] = stats.group(6)
        metrics["std_error"] = stats.group(7)
    
    # Extract percentiles and min/max
    # This approach directly searches for each percentile in the content
    min_match = re.search(r"---> <MIN> observation =\s+([0-9.]+)", content)
    if min_match:
        metrics["min_latency"] = min_match.group(1)
    
    max_match = re.search(r"---> <MAX> observation =\s+([0-9.]+)", content)
    if max_match:
        metrics["max_latency"] = max_match.group(1)
    
    p25_match = re.search(r"---> percentile 25\.0+\s*=\s*([0-9.]+)", content)
    if p25_match:
        metrics["percentile_25"] = p25_match.group(1)
    
    p50_match = re.search(r"---> percentile 50\.0+\s*=\s*([0-9.]+)", content)
    if p50_match:
        metrics["percentile_50"] = p50_match.group(1)
    
    p75_match = re.search(r"---> percentile 75\.0+\s*=\s*([0-9.]+)", content)
    if p75_match:
        metrics["percentile_75"] = p75_match.group(1)
    
    p90_match = re.search(r"---> percentile 90\.0+\s*=\s*([0-9.]+)", content)
    if p90_match:
        metrics["percentile_90"] = p90_match.group(1)
    
    p99_match = re.search(r"---> percentile 99\.0+\s*=\s*([0-9.]+)", content)
    if p99_match:
        metrics["percentile_99"] = p99_match.group(1)
    
    p999_match = re.search(r"---> percentile 99\.9+\s*=\s*([0-9.]+)", content)
    if p999_match:
        metrics["percentile_999"] = p999_match.group(1)
    
    p9999_match = re.search(r"---> percentile 99\.99+\s*=\s*([0-9.]+)", content)
    if p9999_match:
        metrics["percentile_9999"] = p9999_match.group(1)
    
    p99999_match = re.search(r"---> percentile 99\.999+\s*=\s*([0-9.]+)", content)
    if p99999_match:
        metrics["percentile_99999"] = p99999_match.group(1)
    
    return metrics

def calculate_improvement(eni_value, srd_value):
    """Calculate improvement percentage between ENI and SRD values."""
    if not eni_value or not srd_value:
        return None
    
    try:
        eni_float = float(eni_value)
        srd_float = float(srd_value)
        
        if eni_float <= 0:
            return None
        
        # For latency metrics, improvement is (ENI - SRD) / ENI * 100
        improvement = ((eni_float - srd_float) / eni_float) * 100
        return improvement
    except (ValueError, ZeroDivisionError, TypeError):
        return None

def run_tests(debug=False):
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
        f.write("Iteration,Repeat,Timestamp,Source_IP,Source_Port,Dest_IP,Dest_Port,Protocol,MPS,Avg_Latency_usec,Min_Latency_usec,Max_Latency_usec,Percentile_50th,Percentile_99th,Percentile_99.9th\n")
    
    with open(srd_summary_file, 'w') as f:
        f.write("Iteration,Repeat,Timestamp,Source_IP,Source_Port,Dest_IP,Dest_Port,Protocol,MPS,Avg_Latency_usec,Min_Latency_usec,Max_Latency_usec,Percentile_50th,Percentile_99th,Percentile_99.9th\n")
    
    with open(comparison_file, 'w') as f:
        f.write("Iteration,Repeat,Timestamp,Protocol,ENI_5Tuple,SRD_5Tuple,ENI_Avg,SRD_Avg,ENI_p50,SRD_p50,ENI_p99,SRD_p99,ENI_Max,SRD_Max,Improvement_Avg_Percent,Improvement_p50_Percent,Improvement_p99_Percent,Improvement_Max_Percent\n")
    
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
            srd_latency_output = f"{output_dir}/srd/iteration_{i}_repeat_{j}_udp_latency.log"
            
            print("Running UDP tests...")
            
            # Run tests in parallel using ThreadPoolExecutor
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
                # Submit latency tests
                eni_latency_future = executor.submit(
                    run_sockperf_test, "ENI", SERVER_IP_ENI, SERVER_PORT_ENI,
                    CLIENT_IP_ENI, CLIENT_PINGPONG_PORT_ENI, eni_latency_output, i, j, debug
                )
                
                srd_latency_future = executor.submit(
                    run_sockperf_test, "SRD", SERVER_IP_SRD, SERVER_PORT_SRD,
                    CLIENT_IP_SRD, CLIENT_PINGPONG_PORT_SRD, srd_latency_output, i, j, debug
                )
                
                # Wait for all tests to complete
                eni_latency_result = eni_latency_future.result()
                srd_latency_result = srd_latency_future.result()
            
            # Process test results
            print("Processing UDP test results...")
            
            # Define 5-tuples
            eni_udp_5tuple = f"{CLIENT_IP_ENI}:{CLIENT_PINGPONG_PORT_ENI}->{SERVER_IP_ENI}:{SERVER_PORT_ENI}/UDP"
            srd_udp_5tuple = f"{CLIENT_IP_SRD}:{CLIENT_PINGPONG_PORT_SRD}->{SERVER_IP_SRD}:{SERVER_PORT_SRD}/UDP"
            
            # Extract metrics
            eni_metrics = extract_metrics_from_file(eni_latency_output)
            srd_metrics = extract_metrics_from_file(srd_latency_output)
            
            # Print comparison summary in table format
            print("\nUDP Results:")
            print(f"ENI 5-Tuple: {eni_udp_5tuple}")
            print(f"SRD 5-Tuple: {srd_udp_5tuple}")
            
            # Print table header
            print("\n{:<30} {:<15} {:<15} {:<15}".format("METRIC", "ENI", "SRD", "DIFFERENCE"))
            print("-" * 75)
            
            # Helper function to format metrics for display
            def format_metric_row(name, eni_key, srd_key, add_unit=True):
                eni_val = eni_metrics.get(eni_key, "N/A")
                srd_val = srd_metrics.get(srd_key, "N/A")
                
                # Format values with μs if needed
                if add_unit and eni_val != "N/A":
                    eni_display = f"{eni_val} μs"
                else:
                    eni_display = eni_val
                
                if add_unit and srd_val != "N/A":
                    srd_display = f"{srd_val} μs"
                else:
                    srd_display = srd_val
                
                # Calculate improvement
                improvement = calculate_improvement(eni_val, srd_val)
                if improvement is not None:
                    diff_display = f"{improvement:.2f}%"
                else:
                    diff_display = "N/A"
                
                print("{:<30} {:<15} {:<15} {:<15}".format(name, eni_display, srd_display, diff_display))
                return improvement
            
            # Print metrics
            format_metric_row("Valid Duration - RunTime", "runtime", "runtime", False)
            format_metric_row("Valid Duration - SentMessages", "sent_messages", "sent_messages", False)
            format_metric_row("Valid Duration - ReceivedMessages", "received_messages", "received_messages", False)
            format_metric_row("# dropped messages", "dropped_messages", "dropped_messages", False)
            format_metric_row("# duplicated messages", "duplicated_messages", "duplicated_messages", False)
            format_metric_row("# out-of-order messages", "out_of_order_messages", "out_of_order_messages", False)
            
            avg_improvement = format_metric_row("avg-latency", "avg_latency", "avg_latency")
            format_metric_row("std-dev", "std_dev", "std_dev", False)
            format_metric_row("mean-ad", "mean_ad", "mean_ad", False)
            format_metric_row("median-ad", "median_ad", "median_ad", False)
            format_metric_row("siqr", "siqr", "siqr", False)
            format_metric_row("cv", "cv", "cv", False)
            format_metric_row("std-error", "std_error", "std_error", False)
            
            max_improvement = format_metric_row("MAX", "max_latency", "max_latency")
            format_metric_row("P99.999", "percentile_99999", "percentile_99999")
            format_metric_row("P99.990", "percentile_9999", "percentile_9999")
            format_metric_row("P99.900", "percentile_999", "percentile_999")
            p99_improvement = format_metric_row("P99.000", "percentile_99", "percentile_99")
            format_metric_row("P90.000", "percentile_90", "percentile_90")
            format_metric_row("P75.000", "percentile_75", "percentile_75")
            p50_improvement = format_metric_row("P50.000", "percentile_50", "percentile_50")
            format_metric_row("P25.000", "percentile_25", "percentile_25")
            
            print("-" * 75)
            
            # Log to ENI summary file
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            with open(eni_summary_file, 'a') as f:
                f.write(f"{i},{j},{timestamp},{CLIENT_IP_ENI},{CLIENT_PINGPONG_PORT_ENI},{SERVER_IP_ENI},{SERVER_PORT_ENI},UDP,{MPS},{eni_metrics.get('avg_latency', 'N/A')},{eni_metrics.get('min_latency', 'N/A')},{eni_metrics.get('max_latency', 'N/A')},{eni_metrics.get('percentile_50', 'N/A')},{eni_metrics.get('percentile_99', 'N/A')},{eni_metrics.get('percentile_999', 'N/A')}\n")
            
            # Log to SRD summary file
            with open(srd_summary_file, 'a') as f:
                f.write(f"{i},{j},{timestamp},{CLIENT_IP_SRD},{CLIENT_PINGPONG_PORT_SRD},{SERVER_IP_SRD},{SERVER_PORT_SRD},UDP,{MPS},{srd_metrics.get('avg_latency', 'N/A')},{srd_metrics.get('min_latency', 'N/A')},{srd_metrics.get('max_latency', 'N/A')},{srd_metrics.get('percentile_50', 'N/A')},{srd_metrics.get('percentile_99', 'N/A')},{srd_metrics.get('percentile_999', 'N/A')}\n")
            
            # Format improvement percentages for CSV
            avg_imp_str = f"{avg_improvement:.2f}" if avg_improvement is not None else "N/A"
            p50_imp_str = f"{p50_improvement:.2f}" if p50_improvement is not None else "N/A"
            p99_imp_str = f"{p99_improvement:.2f}" if p99_improvement is not None else "N/A"
            max_imp_str = f"{max_improvement:.2f}" if max_improvement is not None else "N/A"
            
            # Log to comparison file
            with open(comparison_file, 'a') as f:
                f.write(f"{i},{j},{timestamp},UDP,\"{eni_udp_5tuple}\",\"{srd_udp_5tuple}\",{eni_metrics.get('avg_latency', 'N/A')},{srd_metrics.get('avg_latency', 'N/A')},{eni_metrics.get('percentile_50', 'N/A')},{srd_metrics.get('percentile_50', 'N/A')},{eni_metrics.get('percentile_99', 'N/A')},{srd_metrics.get('percentile_99', 'N/A')},{eni_metrics.get('max_latency', 'N/A')},{srd_metrics.get('max_latency', 'N/A')},{avg_imp_str},{p50_imp_str},{p99_imp_str},{max_imp_str}\n")
            
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
    
    # Generate summary report (only save to file, don't print to console)
    print("Tests completed. Generating summary report...")
    
    # Create summary report
    summary_report = f"{output_dir}/summary_report.txt"
    with open(summary_report, 'w') as f:
        f.write(f"ENA vs ENA Express Performance Summary\n")
        f.write(f"Test Date: {datetime.datetime.now().strftime('%a %b %d %H:%M:%S %Z %Y')}\n")
        f.write(f"Test Start Time: {test_start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Test End Time: {test_end_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Total Iterations: {ITERATIONS}\n")
        f.write(f"Repeats per Iteration: {REPEAT}\n")
        f.write(f"Total Tests: {ITERATIONS * REPEAT}\n\n")
        
        f.write(f"Connection Details:\n")
        f.write(f"Regular ENI:\n")
        f.write(f"  Source IP: {CLIENT_IP_ENI}\n")
        f.write(f"  Destination IP: {SERVER_IP_ENI}\n\n")
        
        f.write(f"ENA Express:\n")
        f.write(f"  Source IP: {CLIENT_IP_SRD}\n")
        f.write(f"  Destination IP: {SERVER_IP_SRD}\n\n")
        
        f.write(f"Results saved in: {output_dir}\n")
    
    # Create a 5-tuple summary file
    tuple_summary = f"{output_dir}/5tuple_summary.txt"
    with open(tuple_summary, 'w') as f:
        f.write(f"5-Tuple Connection Details\n\n")
        
        f.write(f"Regular ENI UDP:\n")
        f.write(f"  Source IP: {CLIENT_IP_ENI}\n")
        f.write(f"  Source Port: {CLIENT_PINGPONG_PORT_ENI}\n")
        f.write(f"  Destination IP: {SERVER_IP_ENI}\n")
        f.write(f"  Destination Port: {SERVER_PORT_ENI}\n")
        f.write(f"  Protocol: UDP\n\n")
        
        f.write(f"ENA Express UDP:\n")
        f.write(f"  Source IP: {CLIENT_IP_SRD}\n")
        f.write(f"  Source Port: {CLIENT_PINGPONG_PORT_SRD}\n")
        f.write(f"  Destination IP: {SERVER_IP_SRD}\n")
        f.write(f"  Destination Port: {SERVER_PORT_SRD}\n")
        f.write(f"  Protocol: UDP\n\n")
        
        f.write(f"Note: Each test uses fixed source ports\n")
    
    print("Test completed successfully!")
    
    return {
        "output_dir": output_dir,
        "summary_report": summary_report,
        "tuple_summary": tuple_summary
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
