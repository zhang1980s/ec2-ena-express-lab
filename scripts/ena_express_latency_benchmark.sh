#!/bin/bash

# Parse command line arguments
DEBUG=false
for arg in "$@"; do
    case $arg in
        --debug)
            DEBUG=true
            shift # Remove --debug from processing
            ;;
        *)
            # Unknown option
            ;;
    esac
done

# Debug output function
debug_echo() {
    if [ "$DEBUG" = true ]; then
        echo "DEBUG: $*"
    fi
}

# IP and port configurations
REMOTE_IP_ENI=192.168.3.10
REMOTE_IP_SRD=192.168.3.11
REMOTE_PORT_ENI=11110
REMOTE_PORT_SRD=11111
LOCAL_IP_ENI=192.168.3.20
LOCAL_IP_SRD=192.168.3.21
BASE_PORT=10000
ITERATIONS=1
REPEAT=1  # Number of times to repeat each test
TEST_DURATION=600  # Test duration in seconds
PRE_WARM_WAIT=60  # Pre-warmup wait time in seconds

# Create output directories and files
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTPUT_DIR="sockperf_results_${TIMESTAMP}"
mkdir -p "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}/eni"
mkdir -p "${OUTPUT_DIR}/srd"

# Summary log files
ENI_SUMMARY="${OUTPUT_DIR}/eni_summary.csv"
SRD_SUMMARY="${OUTPUT_DIR}/srd_summary.csv"
COMPARISON="${OUTPUT_DIR}/comparison.csv"

# Create headers for summary files
echo "Iteration,Repeat,Timestamp,Source_IP,Source_Port,Dest_IP,Dest_Port,Protocol,MPS,Avg_Latency_usec,Min_Latency_usec,Max_Latency_usec,Percentile_50th,Percentile_99th,Percentile_99.9th" > "${ENI_SUMMARY}"
echo "Iteration,Repeat,Timestamp,Source_IP,Source_Port,Dest_IP,Dest_Port,Protocol,MPS,Avg_Latency_usec,Min_Latency_usec,Max_Latency_usec,Percentile_50th,Percentile_99th,Percentile_99.9th" > "${SRD_SUMMARY}"
echo "Iteration,Repeat,Timestamp,ENI_5Tuple,SRD_5Tuple,ENI_Avg,SRD_Avg,ENI_p50,SRD_p50,ENI_p99,SRD_p99,Improvement_Avg_Percent,Improvement_p50_Percent,Improvement_p99_Percent" > "${COMPARISON}"

# Function to check if sockperf server is running
check_sockperf_server() {
    local remote_ip=$1
    local remote_port=$2
    local test_type=$3
    
    echo "Checking if sockperf server is running at ${remote_ip}:${remote_port} (${test_type})..."
    
    # Try a simple ping-pong test with a short timeout
    local output_file="/tmp/sockperf_check_${test_type}.log"
    timeout 5 sockperf ping-pong -i "${remote_ip}" -p "${remote_port}" --time 1 > "${output_file}" 2>&1
    local status=$?
    
    if [ $status -ne 0 ]; then
        echo "ERROR: sockperf server at ${remote_ip}:${remote_port} (${test_type}) is not responding."
        echo "Error details:"
        cat "${output_file}"
        echo ""
        echo "Please make sure the server is running with:"
        echo "  sockperf server -i ${remote_ip} -p ${remote_port}"
        
        # Try to ping the server to check basic connectivity
        echo "Checking basic connectivity to ${remote_ip}..."
        ping -c 1 "${remote_ip}" > /dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo "Ping successful. The host is reachable but sockperf server may not be running."
        else
            echo "Ping failed. The host may be unreachable."
        fi
        
        return 1
    else
        echo "sockperf server at ${remote_ip}:${remote_port} (${test_type}) is running."
        return 0
    fi
}

# Function to run sockperf test and return metrics
run_sockperf() {
    local remote_ip=$1
    local remote_port=$2
    local local_ip=$3
    local local_port=$4
    local output_file=$5
    local type=$6
    local iteration=$7
    local repeat=$8
    
    local five_tuple="${local_ip}:${local_port}->${remote_ip}:${remote_port}/UDP"
    
    echo "Running ${type} UDP test (Iteration ${iteration}, Repeat ${repeat}): ${five_tuple}" >&2
    
    # Run sockperf UDP test
    sockperf ping-pong -i "${remote_ip}" -p "${remote_port}" \
        --client_ip "${local_ip}" --client_port "${local_port}" \
        --time ${TEST_DURATION} --msg-size 64 --mps 100 \
        --pre-warmup-wait ${PRE_WARM_WAIT} > "${output_file}" 2>&1
    
    # Check if the command succeeded
    if [ $? -ne 0 ]; then
        echo "ERROR: UDP sockperf command failed for ${type} test." >&2
        echo "Command output:" >&2
        cat "${output_file}" >&2
        return 1
    fi
    
    # Extract key metrics
    local timestamp=$(date +"%Y-%m-%d %H:%M:%S")
    local avg_latency=$(grep -oP "avg-lat=\K[0-9.]+" "${output_file}" || echo "N/A")
    local min_latency=$(grep -oP "min-lat=\K[0-9.]+" "${output_file}" || echo "N/A")
    local max_latency=$(grep -oP "max-lat=\K[0-9.]+" "${output_file}" || echo "N/A")
    local percentile_50=$(grep -oP "median-lat=\K[0-9.]+" "${output_file}" || echo "N/A")
    local percentile_99=$(grep -oP "percentile 99.00=\K[0-9.]+" "${output_file}" || echo "N/A")
    local percentile_999=$(grep -oP "percentile 99.90=\K[0-9.]+" "${output_file}" || echo "N/A")
    local mps=$(grep -oP "Rate=\K[0-9.]+" "${output_file}" || echo "N/A")
    
    # Add 5-tuple information to the beginning of the output file
    sed -i "1i\# 5-Tuple: ${five_tuple}" "${output_file}"
    sed -i "2i\# Test type: ${type}" "${output_file}"
    sed -i "3i\# Iteration: ${iteration}, Repeat: ${repeat}" "${output_file}"
    sed -i "4i\# Timestamp: ${timestamp}" "${output_file}"
    sed -i "5i\#----------------------------------------------------" "${output_file}"
    
    # Log summary
    if [[ "${type}" == "ENI" ]]; then
        echo "${iteration},${repeat},${timestamp},${local_ip},${local_port},${remote_ip},${remote_port},UDP,${mps},${avg_latency},${min_latency},${max_latency},${percentile_50},${percentile_99},${percentile_999}" >> "${ENI_SUMMARY}"
    else
        echo "${iteration},${repeat},${timestamp},${local_ip},${local_port},${remote_ip},${remote_port},UDP,${mps},${avg_latency},${min_latency},${max_latency},${percentile_50},${percentile_99},${percentile_999}" >> "${SRD_SUMMARY}"
    fi
    
    # Return key metrics for comparison (separate from 5-tuple)
    echo "${five_tuple};${avg_latency};${percentile_50};${percentile_99};${max_latency}"
}

# Function to extract metrics from sockperf output file
extract_metrics() {
    local output_file=$1
    local five_tuple=$2
    
    debug_echo "Extracting metrics from ${output_file} for ${five_tuple}"
    
    # Check if file exists and has content
    if [ ! -f "${output_file}" ]; then
        debug_echo "File ${output_file} does not exist"
        echo "${five_tuple};N/A;N/A;N/A;N/A"
        return
    fi
    
    # Check file size
    local file_size=$(wc -c < "${output_file}")
    debug_echo "File size: ${file_size} bytes"
    
    # Show file content for debugging
    if [ "$DEBUG" = true ]; then
        debug_echo "File content (first 20 lines):"
        head -n 20 "${output_file}" | while IFS= read -r line; do
            debug_echo "  $line"
        done
    fi
    
    # Try many different patterns to extract the average latency
    local avg_latency=$(grep -oP "avg-lat=\K[0-9.]+" "${output_file}" 2>/dev/null || 
                        grep -oP "Summary: Latency is \K[0-9.]+" "${output_file}" 2>/dev/null ||
                        grep -oP "Average latency.*: \K[0-9.]+" "${output_file}" 2>/dev/null ||
                        grep -oP "avg.*latency.*: \K[0-9.]+" "${output_file}" 2>/dev/null ||
                        grep -oP "average.*: \K[0-9.]+" "${output_file}" 2>/dev/null ||
                        grep -oP "latency average: \K[0-9.]+" "${output_file}" 2>/dev/null ||
                        grep -oP "average = \K[0-9.]+" "${output_file}" 2>/dev/null ||
                        echo "N/A")
    debug_echo "avg_latency = ${avg_latency}"
    
    # Extract the p50 value using awk to handle the variable spacing
    local percentile_50=$(awk '/sockperf: ---> percentile 50.000 =/ {print $6}' "${output_file}" 2>/dev/null ||
                          awk '/sockperf: ---> percentile 50.00 =/ {print $6}' "${output_file}" 2>/dev/null ||
                          awk '/sockperf: ---> percentile 50.0 =/ {print $6}' "${output_file}" 2>/dev/null ||
                          awk '/sockperf: ---> percentile 50 =/ {print $6}' "${output_file}" 2>/dev/null ||
                          echo "N/A")
    debug_echo "percentile_50 = ${percentile_50}"
    
    # Extract the p99 value using awk to handle the variable spacing
    local percentile_99=$(awk '/sockperf: ---> percentile 99.000 =/ {print $6}' "${output_file}" 2>/dev/null ||
                          awk '/sockperf: ---> percentile 99.00 =/ {print $6}' "${output_file}" 2>/dev/null ||
                          awk '/sockperf: ---> percentile 99.0 =/ {print $6}' "${output_file}" 2>/dev/null ||
                          awk '/sockperf: ---> percentile 99 =/ {print $6}' "${output_file}" 2>/dev/null ||
                          echo "N/A")
    debug_echo "percentile_99 = ${percentile_99}"
    
    # Extract the max latency value
    local max_latency=$(awk '/sockperf: ---> <MAX> observation =/ {print $6}' "${output_file}" 2>/dev/null ||
                        echo "N/A")
    debug_echo "max_latency = ${max_latency}"
    
    echo "${five_tuple};${avg_latency};${percentile_50};${percentile_99};${max_latency}"
}

# Check if sockperf servers are running
check_sockperf_server "${REMOTE_IP_ENI}" "${REMOTE_PORT_ENI}" "ENI" || exit 1
check_sockperf_server "${REMOTE_IP_SRD}" "${REMOTE_PORT_SRD}" "SRD" || exit 1

# Record test start time
TEST_START_TIME=$(date +"%Y-%m-%d %H:%M:%S")
echo "========================================================"
echo "Test started at: ${TEST_START_TIME}"
echo "========================================================"

# Main test loop
for ((i = 0; i < ITERATIONS; i++)); do
    PORT_ENI_BASE=$((BASE_PORT + i * 2))
    PORT_SRD_BASE=$((BASE_PORT + i * 2 + 1))
    
    for ((j = 0; j < REPEAT; j++)); do
        echo "===== Starting test iteration $((i+1))/$ITERATIONS, repeat $((j+1))/$REPEAT ====="
        
        # Run UDP tests in parallel
        ENI_UDP_OUTPUT="${OUTPUT_DIR}/eni/iteration_${i}_repeat_${j}_udp.log"
        SRD_UDP_OUTPUT="${OUTPUT_DIR}/srd/iteration_${i}_repeat_${j}_udp.log"
        
        echo "Running UDP tests..."
        
        # Run ENI UDP test in background
        run_sockperf "${REMOTE_IP_ENI}" "${REMOTE_PORT_ENI}" "${LOCAL_IP_ENI}" "${PORT_ENI_BASE}" "${ENI_UDP_OUTPUT}" "ENI" "$i" "$j" > /dev/null &
        ENI_UDP_PID=$!
        
        # Run SRD UDP test in background
        run_sockperf "${REMOTE_IP_SRD}" "${REMOTE_PORT_SRD}" "${LOCAL_IP_SRD}" "${PORT_SRD_BASE}" "${SRD_UDP_OUTPUT}" "SRD" "$i" "$j" > /dev/null &
        SRD_UDP_PID=$!
        
        # Wait for UDP tests to complete
        wait $ENI_UDP_PID
        wait $SRD_UDP_PID
        
        # Process UDP test results
        echo "Processing UDP test results..."
        ENI_UDP_5TUPLE="${LOCAL_IP_ENI}:${PORT_ENI_BASE}->${REMOTE_IP_ENI}:${REMOTE_PORT_ENI}/UDP"
        SRD_UDP_5TUPLE="${LOCAL_IP_SRD}:${PORT_SRD_BASE}->${REMOTE_IP_SRD}:${REMOTE_PORT_SRD}/UDP"
        
        ENI_UDP_METRICS=$(extract_metrics "${ENI_UDP_OUTPUT}" "${ENI_UDP_5TUPLE}")
        SRD_UDP_METRICS=$(extract_metrics "${SRD_UDP_OUTPUT}" "${SRD_UDP_5TUPLE}")
        
        # Parse UDP metrics - using semicolon as separator to avoid issues with commas in the 5-tuple
        ENI_UDP_5TUPLE=$(echo "$ENI_UDP_METRICS" | cut -d';' -f1)
        ENI_UDP_AVG=$(echo "$ENI_UDP_METRICS" | cut -d';' -f2)
        ENI_UDP_P50=$(echo "$ENI_UDP_METRICS" | cut -d';' -f3)
        ENI_UDP_P99=$(echo "$ENI_UDP_METRICS" | cut -d';' -f4)
        ENI_UDP_MAX=$(echo "$ENI_UDP_METRICS" | cut -d';' -f5)
        
        SRD_UDP_5TUPLE=$(echo "$SRD_UDP_METRICS" | cut -d';' -f1)
        SRD_UDP_AVG=$(echo "$SRD_UDP_METRICS" | cut -d';' -f2)
        SRD_UDP_P50=$(echo "$SRD_UDP_METRICS" | cut -d';' -f3)
        SRD_UDP_P99=$(echo "$SRD_UDP_METRICS" | cut -d';' -f4)
        SRD_UDP_MAX=$(echo "$SRD_UDP_METRICS" | cut -d';' -f5)
        
        # Calculate UDP improvement percentages - only using numeric values
        if [[ "$ENI_UDP_AVG" != "N/A" && "$SRD_UDP_AVG" != "N/A" && -n "$ENI_UDP_AVG" && -n "$SRD_UDP_AVG" ]]; then
            # Use awk for calculation to avoid dependency on bc
            UDP_AVG_IMPROVEMENT=$(awk -v eni="$ENI_UDP_AVG" -v srd="$SRD_UDP_AVG" 'BEGIN {if(eni > 0) printf "%.2f", ((eni-srd)/eni)*100; else print "N/A"}')
        else
            UDP_AVG_IMPROVEMENT="N/A"
        fi
        
        if [[ "$ENI_UDP_P50" != "N/A" && "$SRD_UDP_P50" != "N/A" && -n "$ENI_UDP_P50" && -n "$SRD_UDP_P50" ]]; then
            # Use awk for calculation to avoid dependency on bc
            UDP_P50_IMPROVEMENT=$(awk -v eni="$ENI_UDP_P50" -v srd="$SRD_UDP_P50" 'BEGIN {if(eni > 0) printf "%.2f", ((eni-srd)/eni)*100; else print "N/A"}')
        else
            UDP_P50_IMPROVEMENT="N/A"
        fi
        
        if [[ "$ENI_UDP_P99" != "N/A" && "$SRD_UDP_P99" != "N/A" && -n "$ENI_UDP_P99" && -n "$SRD_UDP_P99" ]]; then
            # Use awk for calculation to avoid dependency on bc
            UDP_P99_IMPROVEMENT=$(awk -v eni="$ENI_UDP_P99" -v srd="$SRD_UDP_P99" 'BEGIN {if(eni > 0) printf "%.2f", ((eni-srd)/eni)*100; else print "N/A"}')
        else
            UDP_P99_IMPROVEMENT="N/A"
        fi
        
        if [[ "$ENI_UDP_MAX" != "N/A" && "$SRD_UDP_MAX" != "N/A" && -n "$ENI_UDP_MAX" && -n "$SRD_UDP_MAX" ]]; then
            # Use awk for calculation to avoid dependency on bc
            UDP_MAX_IMPROVEMENT=$(awk -v eni="$ENI_UDP_MAX" -v srd="$SRD_UDP_MAX" 'BEGIN {if(eni > 0) printf "%.2f", ((eni-srd)/eni)*100; else print "N/A"}')
        else
            UDP_MAX_IMPROVEMENT="N/A"
        fi
        
        # Log comparison
        TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
        echo "${i},${j},${TIMESTAMP},UDP,\"${ENI_UDP_5TUPLE}\",\"${SRD_UDP_5TUPLE}\",${ENI_UDP_AVG},${SRD_UDP_AVG},${ENI_UDP_P50},${SRD_UDP_P50},${ENI_UDP_P99},${SRD_UDP_P99},${ENI_UDP_MAX},${SRD_UDP_MAX},${UDP_AVG_IMPROVEMENT},${UDP_P50_IMPROVEMENT},${UDP_P99_IMPROVEMENT},${UDP_MAX_IMPROVEMENT}" >> "${COMPARISON}"
        
        # Format UDP improvement percentages with proper handling for N/A values
        if [[ "$UDP_AVG_IMPROVEMENT" == "N/A" ]]; then
            UDP_AVG_IMPROVEMENT_DISPLAY="N/A"
        else
            UDP_AVG_IMPROVEMENT_DISPLAY="${UDP_AVG_IMPROVEMENT}%"
        fi
        
        if [[ "$UDP_P50_IMPROVEMENT" == "N/A" ]]; then
            UDP_P50_IMPROVEMENT_DISPLAY="N/A"
        else
            UDP_P50_IMPROVEMENT_DISPLAY="${UDP_P50_IMPROVEMENT}%"
        fi
        
        if [[ "$UDP_P99_IMPROVEMENT" == "N/A" ]]; then
            UDP_P99_IMPROVEMENT_DISPLAY="N/A"
        else
            UDP_P99_IMPROVEMENT_DISPLAY="${UDP_P99_IMPROVEMENT}%"
        fi
        
        if [[ "$UDP_MAX_IMPROVEMENT" == "N/A" ]]; then
            UDP_MAX_IMPROVEMENT_DISPLAY="N/A"
        else
            UDP_MAX_IMPROVEMENT_DISPLAY="${UDP_MAX_IMPROVEMENT}%"
        fi
        
        # Print comparison summary with 5-tuple information
        echo "Test iteration $((i+1))/$ITERATIONS, repeat $((j+1))/$REPEAT completed"
        echo ""
        echo "UDP Results:"
        echo "ENI 5-Tuple: ${ENI_UDP_5TUPLE}"
        echo "SRD 5-Tuple: ${SRD_UDP_5TUPLE}"
        echo "ENI Average: ${ENI_UDP_AVG} μs | SRD Average: ${SRD_UDP_AVG} μs | Improvement: ${UDP_AVG_IMPROVEMENT_DISPLAY}"
        echo "ENI p50: ${ENI_UDP_P50} μs | SRD p50: ${SRD_UDP_P50} μs | Improvement: ${UDP_P50_IMPROVEMENT_DISPLAY}"
        echo "ENI p99: ${ENI_UDP_P99} μs | SRD p99: ${SRD_UDP_P99} μs | Improvement: ${UDP_P99_IMPROVEMENT_DISPLAY}"
        echo "ENI MAX: ${ENI_UDP_MAX} μs | SRD MAX: ${SRD_UDP_MAX} μs | Improvement: ${UDP_MAX_IMPROVEMENT_DISPLAY}"
        echo "-----------------------------------------------------"
        
        # Optional delay between repeats
        if [[ $j -lt $((REPEAT-1)) ]]; then
            echo "Waiting 10 seconds before next repeat..."
            sleep 10
        fi
    done
    
    # Optional delay between iterations
    if [[ $i -lt $((ITERATIONS-1)) ]]; then
        echo "Waiting 30 seconds before next iteration..."
        sleep 30
    fi
done

# Record test end time
TEST_END_TIME=$(date +"%Y-%m-%d %H:%M:%S")
echo "========================================================"
echo "Test ended at: ${TEST_END_TIME}"
echo "========================================================"

# Generate summary report
echo "Tests completed. Generating summary report..."

# Calculate UDP averages from the comparison file
UDP_ENI_AVG=$(awk -F, '$4=="UDP" {sum+=$7; count++} END {if(count>0) print sum/count; else print "N/A"}' "${COMPARISON}")
UDP_SRD_AVG=$(awk -F, '$4=="UDP" {sum+=$8; count++} END {if(count>0) print sum/count; else print "N/A"}' "${COMPARISON}")
UDP_ENI_P50=$(awk -F, '$4=="UDP" {sum+=$9; count++} END {if(count>0) print sum/count; else print "N/A"}' "${COMPARISON}")
UDP_SRD_P50=$(awk -F, '$4=="UDP" {sum+=$10; count++} END {if(count>0) print sum/count; else print "N/A"}' "${COMPARISON}")
UDP_ENI_P99=$(awk -F, '$4=="UDP" {sum+=$11; count++} END {if(count>0) print sum/count; else print "N/A"}' "${COMPARISON}")
UDP_SRD_P99=$(awk -F, '$4=="UDP" {sum+=$12; count++} END {if(count>0) print sum/count; else print "N/A"}' "${COMPARISON}")
UDP_ENI_MAX=$(awk -F, '$4=="UDP" {sum+=$13; count++} END {if(count>0) print sum/count; else print "N/A"}' "${COMPARISON}")
UDP_SRD_MAX=$(awk -F, '$4=="UDP" {sum+=$14; count++} END {if(count>0) print sum/count; else print "N/A"}' "${COMPARISON}")

# Calculate improvement percentages using awk for safer calculations
if [[ "$UDP_ENI_AVG" != "N/A" && "$UDP_SRD_AVG" != "N/A" ]]; then
    # Use awk for calculation to avoid dependency on bc
    UDP_AVG_IMPROVEMENT=$(awk -v eni="$UDP_ENI_AVG" -v srd="$UDP_SRD_AVG" 'BEGIN {if(eni > 0) printf "%.2f", ((eni-srd)/eni)*100; else print "N/A"}')
else
    UDP_AVG_IMPROVEMENT="N/A"
fi

if [[ "$UDP_ENI_P50" != "N/A" && "$UDP_SRD_P50" != "N/A" ]]; then
    # Use awk for calculation to avoid dependency on bc
    UDP_P50_IMPROVEMENT=$(awk -v eni="$UDP_ENI_P50" -v srd="$UDP_SRD_P50" 'BEGIN {if(eni > 0) printf "%.2f", ((eni-srd)/eni)*100; else print "N/A"}')
else
    UDP_P50_IMPROVEMENT="N/A"
fi

if [[ "$UDP_ENI_P99" != "N/A" && "$UDP_SRD_P99" != "N/A" ]]; then
    # Use awk for calculation to avoid dependency on bc
    UDP_P99_IMPROVEMENT=$(awk -v eni="$UDP_ENI_P99" -v srd="$UDP_SRD_P99" 'BEGIN {if(eni > 0) printf "%.2f", ((eni-srd)/eni)*100; else print "N/A"}')
else
    UDP_P99_IMPROVEMENT="N/A"
fi

if [[ "$UDP_ENI_MAX" != "N/A" && "$UDP_SRD_MAX" != "N/A" ]]; then
    # Use awk for calculation to avoid dependency on bc
    UDP_MAX_IMPROVEMENT=$(awk -v eni="$UDP_ENI_MAX" -v srd="$UDP_SRD_MAX" 'BEGIN {if(eni > 0) printf "%.2f", ((eni-srd)/eni)*100; else print "N/A"}')
else
    UDP_MAX_IMPROVEMENT="N/A"
fi

# Format improvement percentages for summary report
if [[ "$UDP_AVG_IMPROVEMENT" == "N/A" ]]; then
    UDP_AVG_IMPROVEMENT_DISPLAY="N/A"
else
    UDP_AVG_IMPROVEMENT_DISPLAY="${UDP_AVG_IMPROVEMENT}%"
fi

if [[ "$UDP_P50_IMPROVEMENT" == "N/A" ]]; then
    UDP_P50_IMPROVEMENT_DISPLAY="N/A"
else
    UDP_P50_IMPROVEMENT_DISPLAY="${UDP_P50_IMPROVEMENT}%"
fi

if [[ "$UDP_P99_IMPROVEMENT" == "N/A" ]]; then
    UDP_P99_IMPROVEMENT_DISPLAY="N/A"
else
    UDP_P99_IMPROVEMENT_DISPLAY="${UDP_P99_IMPROVEMENT}%"
fi

if [[ "$UDP_MAX_IMPROVEMENT" == "N/A" ]]; then
    UDP_MAX_IMPROVEMENT_DISPLAY="N/A"
else
    UDP_MAX_IMPROVEMENT_DISPLAY="${UDP_MAX_IMPROVEMENT}%"
fi

# Create summary report
SUMMARY_REPORT="${OUTPUT_DIR}/summary_report.txt"
{
    echo "========================================================"
    echo "          ENA vs ENA Express Performance Summary        "
    echo "========================================================"
    echo "Test Date: $(date)"
    echo "Test Start Time: ${TEST_START_TIME}"
    echo "Test End Time: ${TEST_END_TIME}"
    echo "Total Iterations: ${ITERATIONS}"
    echo "Repeats per Iteration: ${REPEAT}"
    echo "Total Tests: $((ITERATIONS * REPEAT))"
    echo "========================================================"
    echo "                     Connection Details                 "
    echo "========================================================"
    echo "Regular ENI:"
    echo "  Source IP: ${LOCAL_IP_ENI}"
    echo "  Destination IP: ${REMOTE_IP_ENI}"
    echo ""
    echo "ENA Express:"
    echo "  Source IP: ${LOCAL_IP_SRD}"
    echo "  Destination IP: ${REMOTE_IP_SRD}"
    echo "========================================================"
    echo "                     UDP Results                        "
    echo "========================================================"
    echo "Average Latency:"
    echo "  Regular ENI: ${UDP_ENI_AVG} μs"
    echo "  ENA Express: ${UDP_SRD_AVG} μs"
    echo "  Improvement: ${UDP_AVG_IMPROVEMENT_DISPLAY}"
    echo ""
    echo "p50 Latency:"
    echo "  Regular ENI: ${UDP_ENI_P50} μs"
    echo "  ENA Express: ${UDP_SRD_P50} μs"
    echo "  Improvement: ${UDP_P50_IMPROVEMENT_DISPLAY}"
    echo ""
    echo "p99 Latency:"
    echo "  Regular ENI: ${UDP_ENI_P99} μs"
    echo "  ENA Express: ${UDP_SRD_P99} μs"
    echo "  Improvement: ${UDP_P99_IMPROVEMENT_DISPLAY}"
    echo ""
    echo "Maximum Latency:"
    echo "  Regular ENI: ${UDP_ENI_MAX} μs"
    echo "  ENA Express: ${UDP_SRD_MAX} μs"
    echo "  Improvement: ${UDP_MAX_IMPROVEMENT_DISPLAY}"
    echo "========================================================"
    echo "Results saved in: ${OUTPUT_DIR}"
    echo "========================================================"
} > "${SUMMARY_REPORT}"

# Create a 5-tuple summary file
TUPLE_SUMMARY="${OUTPUT_DIR}/5tuple_summary.txt"
{
    echo "========================================================"
    echo "                 5-Tuple Connection Details             "
    echo "========================================================"
    echo "Regular ENI UDP:"
    echo "  Source IP: ${LOCAL_IP_ENI}"
    echo "  Source Ports: ${BASE_PORT} to $((BASE_PORT + ITERATIONS*2 - 2)) (step 2)"
    echo "  Destination IP: ${REMOTE_IP_ENI}"
    echo "  Destination Port: ${REMOTE_PORT_ENI}"
    echo "  Protocol: UDP"
    echo ""
    echo "ENA Express UDP:"
    echo "  Source IP: ${LOCAL_IP_SRD}"
    echo "  Source Ports: $((BASE_PORT + 1)) to $((BASE_PORT + ITERATIONS*2 - 1)) (step 2)"
    echo "  Destination IP: ${REMOTE_IP_SRD}"
    echo "  Destination Port: ${REMOTE_PORT_SRD}"
    echo "  Protocol: UDP"
    echo "========================================================"
    echo "Note: Each test iteration uses unique source ports"
    echo "========================================================"
} > "${TUPLE_SUMMARY}"

# Display summary report
cat "${SUMMARY_REPORT}"
echo ""
cat "${TUPLE_SUMMARY}"

echo "Test completed successfully!"
