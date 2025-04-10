#!/bin/bash
# Script to run network performance tests between two EC2 instances using sockperf
# For ENA vs ENA Express latency and bandwidth performance testing

# Usage: ./run-performance-tests.sh [server|client] [server-ip] [interface-type]
# Example (server): ./run-performance-tests.sh server
# Example (client): ./run-performance-tests.sh client 10.0.0.10 ena-express

set -e

MODE=$1
SERVER_IP=$2
INTERFACE_TYPE=$3
OUTPUT_DIR="test_results_$(date +%Y%m%d_%H%M%S)"

# Create output directory
mkdir -p $OUTPUT_DIR

# Create log directory for Prometheus exporter
LOG_DIR="/var/log/sockperf"
sudo mkdir -p $LOG_DIR
sudo chmod 777 $LOG_DIR

# Define ports for different tests
TCP_LATENCY_PORT=11111
UDP_LATENCY_PORT=11112
TCP_THROUGHPUT_PORT=11113
UDP_THROUGHPUT_PORT=11114

# Function to run server tests
run_server() {
    echo "Starting server mode..."
    echo "Press Ctrl+C to stop the server when testing is complete."
    
    # Start sockperf servers for different test types
    echo "Starting sockperf server for TCP latency tests on port $TCP_LATENCY_PORT..."
    sockperf server --tcp -p $TCP_LATENCY_PORT > $OUTPUT_DIR/sockperf_tcp_latency_server.log &
    TCP_LAT_PID=$!
    
    echo "Starting sockperf server for UDP latency tests on port $UDP_LATENCY_PORT..."
    sockperf server --udp -p $UDP_LATENCY_PORT > $OUTPUT_DIR/sockperf_udp_latency_server.log &
    UDP_LAT_PID=$!
    
    echo "Starting sockperf server for TCP throughput tests on port $TCP_THROUGHPUT_PORT..."
    sockperf server --tcp -p $TCP_THROUGHPUT_PORT > $OUTPUT_DIR/sockperf_tcp_throughput_server.log &
    TCP_TP_PID=$!
    
    echo "Starting sockperf server for UDP throughput tests on port $UDP_THROUGHPUT_PORT..."
    sockperf server --udp -p $UDP_THROUGHPUT_PORT > $OUTPUT_DIR/sockperf_udp_throughput_server.log &
    UDP_TP_PID=$!
    
    echo "All sockperf servers started. Waiting for client connections..."
    echo "Server logs will be saved in the $OUTPUT_DIR directory."
    
    # Wait for Ctrl+C
    trap "kill $TCP_LAT_PID $UDP_LAT_PID $TCP_TP_PID $UDP_TP_PID; echo 'Servers stopped.'; exit 0" INT
    wait
}

# Function to run client tests
run_client() {
    if [ -z "$SERVER_IP" ]; then
        echo "Error: Server IP address is required for client mode."
        echo "Usage: $0 client <server-ip> [ena|ena-express]"
        exit 1
    fi
    
    echo "Starting client mode, connecting to server at $SERVER_IP..."
    echo "Test results will be saved in the $OUTPUT_DIR directory."
    
    # Determine which tests to run based on interface type
    if [ "$INTERFACE_TYPE" == "ena" ] || [ -z "$INTERFACE_TYPE" ]; then
        # Run standard ENA tests
        echo "Running TCP latency tests with standard ENA..."
        sockperf ping-pong --tcp -i $SERVER_IP -p $TCP_LATENCY_PORT -t 60 -m 64 --full-log $OUTPUT_DIR/sockperf_tcp_latency_ena.csv | tee $LOG_DIR/sockperf_ping-pong_tcp_ena.log
        echo "TCP latency test complete."
        
        echo "Running UDP latency tests with standard ENA..."
        sockperf ping-pong --udp -i $SERVER_IP -p $UDP_LATENCY_PORT -t 60 -m 64 --full-log $OUTPUT_DIR/sockperf_udp_latency_ena.csv | tee $LOG_DIR/sockperf_ping-pong_udp_ena.log
        echo "UDP latency test complete."
        
        echo "Running TCP throughput tests with standard ENA..."
        sockperf throughput --tcp -i $SERVER_IP -p $TCP_THROUGHPUT_PORT -t 60 -m 1472 --full-log $OUTPUT_DIR/sockperf_tcp_throughput_ena.csv | tee $LOG_DIR/sockperf_throughput_tcp_ena.log
        echo "TCP throughput test complete."
        
        echo "Running UDP throughput tests with standard ENA..."
        sockperf throughput --udp -i $SERVER_IP -p $UDP_THROUGHPUT_PORT -t 60 -m 1472 --full-log $OUTPUT_DIR/sockperf_udp_throughput_ena.csv | tee $LOG_DIR/sockperf_throughput_udp_ena.log
        echo "UDP throughput test complete."
    fi
    
    if [ "$INTERFACE_TYPE" == "ena-express" ] || [ -z "$INTERFACE_TYPE" ]; then
        # Run ENA Express tests
        echo "Running TCP latency tests with ENA Express..."
        sockperf ping-pong --tcp -i $SERVER_IP -p $TCP_LATENCY_PORT -t 60 -m 64 --full-log $OUTPUT_DIR/sockperf_tcp_latency_ena_express.csv | tee $LOG_DIR/sockperf_ping-pong_tcp_ena_express.log
        echo "TCP latency test complete."
        
        echo "Running UDP latency tests with ENA Express..."
        sockperf ping-pong --udp -i $SERVER_IP -p $UDP_LATENCY_PORT -t 60 -m 64 --full-log $OUTPUT_DIR/sockperf_udp_latency_ena_express.csv | tee $LOG_DIR/sockperf_ping-pong_udp_ena_express.log
        echo "UDP latency test complete."
        
        echo "Running TCP throughput tests with ENA Express..."
        sockperf throughput --tcp -i $SERVER_IP -p $TCP_THROUGHPUT_PORT -t 60 -m 1472 --full-log $OUTPUT_DIR/sockperf_tcp_throughput_ena_express.csv | tee $LOG_DIR/sockperf_throughput_tcp_ena_express.log
        echo "TCP throughput test complete."
        
        echo "Running UDP throughput tests with ENA Express..."
        sockperf throughput --udp -i $SERVER_IP -p $UDP_THROUGHPUT_PORT -t 60 -m 1472 --full-log $OUTPUT_DIR/sockperf_udp_throughput_ena_express.csv | tee $LOG_DIR/sockperf_throughput_udp_ena_express.log
        echo "UDP throughput test complete."
    fi
    
    echo "All tests completed. Results saved in $OUTPUT_DIR directory."
    
    # Process results to extract key metrics
    process_results
    
    # Generate summary report
    generate_summary_report
    
    echo "Summary report generated: $OUTPUT_DIR/summary_report.md"
}

# Function to process results and extract key metrics
process_results() {
    echo "Processing test results..."
    
    # Process TCP latency results
    if [ -f "$OUTPUT_DIR/sockperf_tcp_latency_ena.csv" ]; then
        # Extract average, median (p50), p99, and p99.9 latencies
        TCP_LAT_ENA_AVG=$(awk -F, 'NR>1 {sum+=$2; count++} END {print sum/count}' $OUTPUT_DIR/sockperf_tcp_latency_ena.csv)
        echo "TCP_LAT_ENA_AVG=$TCP_LAT_ENA_AVG" > $OUTPUT_DIR/metrics.txt
        
        # Sort latencies and extract percentiles
        sort -n -t, -k2 $OUTPUT_DIR/sockperf_tcp_latency_ena.csv > $OUTPUT_DIR/sorted_tcp_lat_ena.csv
        TOTAL_LINES=$(wc -l < $OUTPUT_DIR/sorted_tcp_lat_ena.csv)
        P50_LINE=$(echo "($TOTAL_LINES * 0.5) / 1" | bc)
        P99_LINE=$(echo "($TOTAL_LINES * 0.99) / 1" | bc)
        P999_LINE=$(echo "($TOTAL_LINES * 0.999) / 1" | bc)
        
        TCP_LAT_ENA_P50=$(sed -n "${P50_LINE}p" $OUTPUT_DIR/sorted_tcp_lat_ena.csv | cut -d, -f2)
        TCP_LAT_ENA_P99=$(sed -n "${P99_LINE}p" $OUTPUT_DIR/sorted_tcp_lat_ena.csv | cut -d, -f2)
        TCP_LAT_ENA_P999=$(sed -n "${P999_LINE}p" $OUTPUT_DIR/sorted_tcp_lat_ena.csv | cut -d, -f2)
        
        echo "TCP_LAT_ENA_P50=$TCP_LAT_ENA_P50" >> $OUTPUT_DIR/metrics.txt
        echo "TCP_LAT_ENA_P99=$TCP_LAT_ENA_P99" >> $OUTPUT_DIR/metrics.txt
        echo "TCP_LAT_ENA_P999=$TCP_LAT_ENA_P999" >> $OUTPUT_DIR/metrics.txt
    fi
    
    # Process ENA Express TCP latency results (similar approach)
    if [ -f "$OUTPUT_DIR/sockperf_tcp_latency_ena_express.csv" ]; then
        TCP_LAT_EXPRESS_AVG=$(awk -F, 'NR>1 {sum+=$2; count++} END {print sum/count}' $OUTPUT_DIR/sockperf_tcp_latency_ena_express.csv)
        echo "TCP_LAT_EXPRESS_AVG=$TCP_LAT_EXPRESS_AVG" >> $OUTPUT_DIR/metrics.txt
        
        sort -n -t, -k2 $OUTPUT_DIR/sockperf_tcp_latency_ena_express.csv > $OUTPUT_DIR/sorted_tcp_lat_express.csv
        TOTAL_LINES=$(wc -l < $OUTPUT_DIR/sorted_tcp_lat_express.csv)
        P50_LINE=$(echo "($TOTAL_LINES * 0.5) / 1" | bc)
        P99_LINE=$(echo "($TOTAL_LINES * 0.99) / 1" | bc)
        P999_LINE=$(echo "($TOTAL_LINES * 0.999) / 1" | bc)
        
        TCP_LAT_EXPRESS_P50=$(sed -n "${P50_LINE}p" $OUTPUT_DIR/sorted_tcp_lat_express.csv | cut -d, -f2)
        TCP_LAT_EXPRESS_P99=$(sed -n "${P99_LINE}p" $OUTPUT_DIR/sorted_tcp_lat_express.csv | cut -d, -f2)
        TCP_LAT_EXPRESS_P999=$(sed -n "${P999_LINE}p" $OUTPUT_DIR/sorted_tcp_lat_express.csv | cut -d, -f2)
        
        echo "TCP_LAT_EXPRESS_P50=$TCP_LAT_EXPRESS_P50" >> $OUTPUT_DIR/metrics.txt
        echo "TCP_LAT_EXPRESS_P99=$TCP_LAT_EXPRESS_P99" >> $OUTPUT_DIR/metrics.txt
        echo "TCP_LAT_EXPRESS_P999=$TCP_LAT_EXPRESS_P999" >> $OUTPUT_DIR/metrics.txt
    fi
    
    # Similar processing for UDP latency and throughput tests
    # (Simplified for brevity - in a real script, you would process all test results)
    
    # Extract throughput metrics from the logs
    if [ -f "$OUTPUT_DIR/sockperf_tcp_throughput_ena.csv" ]; then
        # Extract throughput from the last line of the log
        TCP_TP_ENA=$(tail -n 1 $OUTPUT_DIR/sockperf_tcp_throughput_ena.csv | cut -d, -f3)
        echo "TCP_TP_ENA=$TCP_TP_ENA" >> $OUTPUT_DIR/metrics.txt
    fi
    
    if [ -f "$OUTPUT_DIR/sockperf_tcp_throughput_ena_express.csv" ]; then
        TCP_TP_EXPRESS=$(tail -n 1 $OUTPUT_DIR/sockperf_tcp_throughput_ena_express.csv | cut -d, -f3)
        echo "TCP_TP_EXPRESS=$TCP_TP_EXPRESS" >> $OUTPUT_DIR/metrics.txt
    fi
}

# Function to generate a summary report
generate_summary_report() {
    echo "Generating summary report..."
    {
        echo "# ENA vs ENA Express Performance Test Results"
        echo "Test Date: $(date)"
        echo "Server IP: $SERVER_IP"
        echo ""
        
        # TCP Latency Comparison
        if [ -f "$OUTPUT_DIR/sockperf_tcp_latency_ena.csv" ] && [ -f "$OUTPUT_DIR/sockperf_tcp_latency_ena_express.csv" ]; then
            echo "## TCP Latency Comparison (microseconds)"
            echo "| Metric | ENA | ENA Express | Improvement |"
            echo "|--------|-----|------------|-------------|"
            
            # Average latency
            ENA_AVG=$(grep "TCP_LAT_ENA_AVG" $OUTPUT_DIR/metrics.txt | cut -d= -f2)
            EXPRESS_AVG=$(grep "TCP_LAT_EXPRESS_AVG" $OUTPUT_DIR/metrics.txt | cut -d= -f2)
            IMPROVEMENT=$(echo "scale=2; (($ENA_AVG - $EXPRESS_AVG) / $ENA_AVG) * 100" | bc)
            echo "| Average | $ENA_AVG | $EXPRESS_AVG | ${IMPROVEMENT}% |"
            
            # p50 latency
            ENA_P50=$(grep "TCP_LAT_ENA_P50" $OUTPUT_DIR/metrics.txt | cut -d= -f2)
            EXPRESS_P50=$(grep "TCP_LAT_EXPRESS_P50" $OUTPUT_DIR/metrics.txt | cut -d= -f2)
            IMPROVEMENT=$(echo "scale=2; (($ENA_P50 - $EXPRESS_P50) / $ENA_P50) * 100" | bc)
            echo "| p50 (median) | $ENA_P50 | $EXPRESS_P50 | ${IMPROVEMENT}% |"
            
            # p99 latency
            ENA_P99=$(grep "TCP_LAT_ENA_P99" $OUTPUT_DIR/metrics.txt | cut -d= -f2)
            EXPRESS_P99=$(grep "TCP_LAT_EXPRESS_P99" $OUTPUT_DIR/metrics.txt | cut -d= -f2)
            IMPROVEMENT=$(echo "scale=2; (($ENA_P99 - $EXPRESS_P99) / $ENA_P99) * 100" | bc)
            echo "| p99 | $ENA_P99 | $EXPRESS_P99 | ${IMPROVEMENT}% |"
            
            # p99.9 latency
            ENA_P999=$(grep "TCP_LAT_ENA_P999" $OUTPUT_DIR/metrics.txt | cut -d= -f2)
            EXPRESS_P999=$(grep "TCP_LAT_EXPRESS_P999" $OUTPUT_DIR/metrics.txt | cut -d= -f2)
            IMPROVEMENT=$(echo "scale=2; (($ENA_P999 - $EXPRESS_P999) / $ENA_P999) * 100" | bc)
            echo "| p99.9 | $ENA_P999 | $EXPRESS_P999 | ${IMPROVEMENT}% |"
            
            echo ""
        fi
        
        # TCP Throughput Comparison
        if [ -f "$OUTPUT_DIR/sockperf_tcp_throughput_ena.csv" ] && [ -f "$OUTPUT_DIR/sockperf_tcp_throughput_ena_express.csv" ]; then
            echo "## TCP Throughput Comparison (Mbps)"
            ENA_TP=$(grep "TCP_TP_ENA" $OUTPUT_DIR/metrics.txt | cut -d= -f2)
            EXPRESS_TP=$(grep "TCP_TP_EXPRESS" $OUTPUT_DIR/metrics.txt | cut -d= -f2)
            IMPROVEMENT=$(echo "scale=2; (($EXPRESS_TP - $ENA_TP) / $ENA_TP) * 100" | bc)
            echo "| ENA | ENA Express | Improvement |"
            echo "|-----|------------|-------------|"
            echo "| $ENA_TP | $EXPRESS_TP | ${IMPROVEMENT}% |"
            echo ""
        fi
        
        # Add similar sections for UDP tests
        
        echo "## Test Details"
        echo "- Message size for latency tests: 64 bytes"
        echo "- Message size for throughput tests: 1472 bytes"
        echo "- Test duration: 60 seconds per test"
        echo ""
        
        echo "For detailed results, check the individual test files in the $OUTPUT_DIR directory."
    } > $OUTPUT_DIR/summary_report.md
}

# Main script execution
case $MODE in
    server)
        run_server
        ;;
    client)
        run_client
        ;;
    *)
        echo "Error: Invalid mode. Use 'server' or 'client'."
        echo "Usage: $0 [server|client] [server-ip] [ena|ena-express]"
        echo "Example (server): $0 server"
        echo "Example (client): $0 client 10.0.0.10 ena-express"
        exit 1
        ;;
esac
