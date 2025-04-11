#!/bin/bash

# IP and port configurations
REMOTE_IP_ENI=192.168.3.59
REMOTE_IP_SRD=192.168.3.145
REMOTE_PORT_ENI=11114
REMOTE_PORT_SRD=11112
LOCAL_IP_ENI=192.168.3.170
LOCAL_IP_SRD=192.168.3.21
BASE_PORT=10004
ITERATIONS=50
REPEAT=10  # Number of times to repeat each test

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

# Function to run sockperf test
run_sockperf() {
    local remote_ip=$1
    local remote_port=$2
    local local_ip=$3
    local local_port=$4
    local output_file=$5
    local type=$6
    local iteration=$7
    local repeat=$8
    
    # Create 5-tuple string (src_ip:src_port -> dst_ip:dst_port/protocol)
    local five_tuple="${local_ip}:${local_port}->${remote_ip}:${remote_port}/TCP"
    
    echo "Running ${type} test (Iteration ${iteration}, Repeat ${repeat}): ${five_tuple}"
    
    # Run sockperf and capture output
    sockperf ping-pong -i "${remote_ip}" -p "${remote_port}" \
        --client_ip "${local_ip}" --client_port "${local_port}" \
        --time 60 --full-rtt --msg-size 1200 --mps 1000 > "${output_file}" 2>&1
    
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
        echo "${iteration},${repeat},${timestamp},${local_ip},${local_port},${remote_ip},${remote_port},TCP,${mps},${avg_latency},${min_latency},${max_latency},${percentile_50},${percentile_99},${percentile_999}" >> "${ENI_SUMMARY}"
    else
        echo "${iteration},${repeat},${timestamp},${local_ip},${local_port},${remote_ip},${remote_port},TCP,${mps},${avg_latency},${min_latency},${max_latency},${percentile_50},${percentile_99},${percentile_999}" >> "${SRD_SUMMARY}"
    fi
    
    # Return key metrics for comparison (separate from 5-tuple)
    echo "${five_tuple};${avg_latency};${percentile_50};${percentile_99}"
}

# Main test loop
for ((i = 0; i < ITERATIONS; i++)); do
    PORT_ENI=$((BASE_PORT + i * 2))
    PORT_SRD=$((BASE_PORT + i * 2 + 1))
    
    for ((j = 0; j < REPEAT; j++)); do
        echo "===== Starting test iteration $((i+1))/$ITERATIONS, repeat $((j+1))/$REPEAT ====="
        
        # Run tests in parallel
        ENI_OUTPUT="${OUTPUT_DIR}/eni/iteration_${i}_repeat_${j}.log"
        SRD_OUTPUT="${OUTPUT_DIR}/srd/iteration_${i}_repeat_${j}.log"
        
        # Run ENI test in background
        run_sockperf "${REMOTE_IP_ENI}" "${REMOTE_PORT_ENI}" "${LOCAL_IP_ENI}" "${PORT_ENI}" "${ENI_OUTPUT}" "ENI" "$i" "$j" > /dev/null &
        ENI_PID=$!
        
        # Run SRD test in background
        run_sockperf "${REMOTE_IP_SRD}" "${REMOTE_PORT_SRD}" "${LOCAL_IP_SRD}" "${PORT_SRD}" "${SRD_OUTPUT}" "SRD" "$i" "$j" > /dev/null &
        SRD_PID=$!
        
        # Wait for both tests to complete
        wait $ENI_PID
        wait $SRD_PID
        
        # Extract metrics for comparison
        ENI_METRICS=$(run_sockperf "${REMOTE_IP_ENI}" "${REMOTE_PORT_ENI}" "${LOCAL_IP_ENI}" "${PORT_ENI}" "${ENI_OUTPUT}" "ENI" "$i" "$j")
        SRD_METRICS=$(run_sockperf "${REMOTE_IP_SRD}" "${REMOTE_PORT_SRD}" "${LOCAL_IP_SRD}" "${PORT_SRD}" "${SRD_OUTPUT}" "SRD" "$i" "$j")
        
        # Parse metrics - using semicolon as separator to avoid issues with commas in the 5-tuple
        ENI_5TUPLE=$(echo "$ENI_METRICS" | cut -d';' -f1)
        ENI_AVG=$(echo "$ENI_METRICS" | cut -d';' -f2)
        ENI_P50=$(echo "$ENI_METRICS" | cut -d';' -f3)
        ENI_P99=$(echo "$ENI_METRICS" | cut -d';' -f4)
        
        SRD_5TUPLE=$(echo "$SRD_METRICS" | cut -d';' -f1)
        SRD_AVG=$(echo "$SRD_METRICS" | cut -d';' -f2)
        SRD_P50=$(echo "$SRD_METRICS" | cut -d';' -f3)
        SRD_P99=$(echo "$SRD_METRICS" | cut -d';' -f4)
        
        # Calculate improvement percentages - only using numeric values
        if [[ "$ENI_AVG" != "N/A" && "$SRD_AVG" != "N/A" ]]; then
            AVG_IMPROVEMENT=$(awk "BEGIN {print (($ENI_AVG-$SRD_AVG)/$ENI_AVG)*100}")
        else
            AVG_IMPROVEMENT="N/A"
        fi
        
        if [[ "$ENI_P50" != "N/A" && "$SRD_P50" != "N/A" ]]; then
            P50_IMPROVEMENT=$(awk "BEGIN {print (($ENI_P50-$SRD_P50)/$ENI_P50)*100}")
        else
            P50_IMPROVEMENT="N/A"
        fi
        
        if [[ "$ENI_P99" != "N/A" && "$SRD_P99" != "N/A" ]]; then
            P99_IMPROVEMENT=$(awk "BEGIN {print (($ENI_P99-$SRD_P99)/$ENI_P99)*100}")
        else
            P99_IMPROVEMENT="N/A"
        fi
        
        # Log comparison
        TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
        echo "${i},${j},${TIMESTAMP},\"${ENI_5TUPLE}\",\"${SRD_5TUPLE}\",${ENI_AVG},${SRD_AVG},${ENI_P50},${SRD_P50},${ENI_P99},${SRD_P99},${AVG_IMPROVEMENT},${P50_IMPROVEMENT},${P99_IMPROVEMENT}" >> "${COMPARISON}"
        
        # Print comparison summary with 5-tuple information
        echo "Test iteration $((i+1))/$ITERATIONS, repeat $((j+1))/$REPEAT completed"
        echo "ENI 5-Tuple: ${ENI_5TUPLE}"
        echo "SRD 5-Tuple: ${SRD_5TUPLE}"
        echo "ENI Average: ${ENI_AVG} μs | SRD Average: ${SRD_AVG} μs | Improvement: ${AVG_IMPROVEMENT}%"
        echo "ENI p50: ${ENI_P50} μs | SRD p50: ${SRD_P50} μs | Improvement: ${P50_IMPROVEMENT}%"
        echo "ENI p99: ${ENI_P99} μs | SRD p99: ${SRD_P99} μs | Improvement: ${P99_IMPROVEMENT}%"
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

# Generate summary report
echo "Tests completed. Generating summary report..."

# Calculate overall averages - adjust column numbers for the new CSV format
ENI_AVG_OVERALL=$(awk -F, 'NR>1 {sum+=$10; count++} END {print sum/count}' "${ENI_SUMMARY}")
SRD_AVG_OVERALL=$(awk -F, 'NR>1 {sum+=$10; count++} END {print sum/count}' "${SRD_SUMMARY}")
ENI_P50_OVERALL=$(awk -F, 'NR>1 {sum+=$13; count++} END {print sum/count}' "${ENI_SUMMARY}")
SRD_P50_OVERALL=$(awk -F, 'NR>1 {sum+=$13; count++} END {print sum/count}' "${SRD_SUMMARY}")
ENI_P99_OVERALL=$(awk -F, 'NR>1 {sum+=$14; count++} END {print sum/count}' "${ENI_SUMMARY}")
SRD_P99_OVERALL=$(awk -F, 'NR>1 {sum+=$14; count++} END {print sum/count}' "${SRD_SUMMARY}")

# Calculate overall improvement
AVG_IMPROVEMENT_OVERALL=$(awk "BEGIN {print (($ENI_AVG_OVERALL-$SRD_AVG_OVERALL)/$ENI_AVG_OVERALL)*100}")
P50_IMPROVEMENT_OVERALL=$(awk "BEGIN {print (($ENI_P50_OVERALL-$SRD_P50_OVERALL)/$ENI_P50_OVERALL)*100}")
P99_IMPROVEMENT_OVERALL=$(awk "BEGIN {print (($ENI_P99_OVERALL-$SRD_P99_OVERALL)/$ENI_P99_OVERALL)*100}")

# Create summary report
SUMMARY_REPORT="${OUTPUT_DIR}/summary_report.txt"
{
    echo "========================================================"
    echo "          ENA vs ENA Express Performance Summary        "
    echo "========================================================"
    echo "Test Date: $(date)"
    echo "Total Iterations: ${ITERATIONS}"
    echo "Repeats per Iteration: ${REPEAT}"
    echo "Total Tests: $((ITERATIONS * REPEAT))"
    echo "========================================================"
    echo "                     Connection Details                 "
    echo "========================================================"
    echo "Regular ENI 5-Tuple: ${LOCAL_IP_ENI}:PORT->${REMOTE_IP_ENI}:${REMOTE_PORT_ENI}/TCP"
    echo "ENA Express 5-Tuple: ${LOCAL_IP_SRD}:PORT->${REMOTE_IP_SRD}:${REMOTE_PORT_SRD}/TCP"
    echo "========================================================"
    echo "                     Average Latency                    "
    echo "========================================================"
    echo "Regular ENI: ${ENI_AVG_OVERALL} μs"
    echo "ENA Express: ${SRD_AVG_OVERALL} μs"
    echo "Improvement: ${AVG_IMPROVEMENT_OVERALL}%"
    echo "========================================================"
    echo "                     p50 Latency                        "
    echo "========================================================"
    echo "Regular ENI: ${ENI_P50_OVERALL} μs"
    echo "ENA Express: ${SRD_P50_OVERALL} μs"
    echo "Improvement: ${P50_IMPROVEMENT_OVERALL}%"
    echo "========================================================"
    echo "                     p99 Latency                        "
    echo "========================================================"
    echo "Regular ENI: ${ENI_P99_OVERALL} μs"
    echo "ENA Express: ${SRD_P99_OVERALL} μs"
    echo "Improvement: ${P99_IMPROVEMENT_OVERALL}%"
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
    echo "Regular ENI:"
    echo "  Source IP: ${LOCAL_IP_ENI}"
    echo "  Source Ports: ${BASE_PORT} to $((BASE_PORT + ITERATIONS*2 - 2)) (even numbers)"
    echo "  Destination IP: ${REMOTE_IP_ENI}"
    echo "  Destination Port: ${REMOTE_PORT_ENI}"
    echo "  Protocol: TCP"
    echo ""
    echo "ENA Express:"
    echo "  Source IP: ${LOCAL_IP_SRD}"
    echo "  Source Ports: $((BASE_PORT + 1)) to $((BASE_PORT + ITERATIONS*2 - 1)) (odd numbers)"
    echo "  Destination IP: ${REMOTE_IP_SRD}"
    echo "  Destination Port: ${REMOTE_PORT_SRD}"
    echo "  Protocol: TCP"
    echo "========================================================"
    echo "Note: Each test iteration uses a unique source port"
    echo "========================================================"
} > "${TUPLE_SUMMARY}"

# Display summary report
cat "${SUMMARY_REPORT}"
echo ""
cat "${TUPLE_SUMMARY}"

echo "Test completed successfully!"
