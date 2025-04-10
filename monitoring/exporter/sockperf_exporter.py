#!/usr/bin/env python3
import time
import re
import os
from prometheus_client import start_http_server, Gauge, Counter
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Define Prometheus metrics
latency_avg = Gauge('sockperf_latency_avg_usec', 'Average latency in microseconds', ['test_type', 'protocol', 'interface'])
latency_p50 = Gauge('sockperf_latency_p50_usec', 'P50 latency in microseconds', ['test_type', 'protocol', 'interface'])
latency_p99 = Gauge('sockperf_latency_p99_usec', 'P99 latency in microseconds', ['test_type', 'protocol', 'interface'])
latency_p999 = Gauge('sockperf_latency_p999_usec', 'P99.9 latency in microseconds', ['test_type', 'protocol', 'interface'])
throughput = Gauge('sockperf_throughput_mbps', 'Throughput in Mbps', ['test_type', 'protocol', 'interface'])
packets_sent = Counter('sockperf_packets_sent_total', 'Total packets sent', ['test_type', 'protocol', 'interface'])
packets_received = Counter('sockperf_packets_received_total', 'Total packets received', ['test_type', 'protocol', 'interface'])

# Regular expressions for parsing sockperf output
latency_pattern = re.compile(r'sockperf: (\w+) summary: Latency (\d+\.\d+) usec')
percentile_pattern = re.compile(r'sockperf: percentile (\d+\.?\d*) = (\d+\.\d+) usec')
throughput_pattern = re.compile(r'sockperf: throughput summary: (\d+\.\d+) Mbps')
packets_pattern = re.compile(r'sockperf: (\d+) packets sent, (\d+) received')

class SockperfLogHandler(FileSystemEventHandler):
    def __init__(self):
        self.current_file = None
        self.current_test_type = None
        self.current_protocol = None
        self.current_interface = None
    
    def on_modified(self, event):
        if not event.is_directory and event.src_path.endswith('.log'):
            self.process_file(event.src_path)
    
    def process_file(self, file_path):
        # Extract test info from filename
        filename = os.path.basename(file_path)
        match = re.match(r'sockperf_(\w+)_(\w+)_(\w+)', filename)
        if match:
            self.current_test_type = match.group(1)  # ping-pong or throughput
            self.current_protocol = match.group(2)   # tcp or udp
            self.current_interface = match.group(3)  # ena or ena_express
        else:
            return
        
        # Process the file
        with open(file_path, 'r') as f:
            # Seek to the end minus 4KB to read recent data
            f.seek(max(0, os.path.getsize(file_path) - 4096))
            content = f.read()
            
            # Parse metrics
            self.parse_metrics(content)
    
    def parse_metrics(self, content):
        # Parse latency
        latency_match = latency_pattern.search(content)
        if latency_match:
            test_type = latency_match.group(1)
            avg_latency = float(latency_match.group(2))
            latency_avg.labels(
                test_type=self.current_test_type,
                protocol=self.current_protocol,
                interface=self.current_interface
            ).set(avg_latency)
        
        # Parse percentiles
        for match in percentile_pattern.finditer(content):
            percentile = float(match.group(1))
            value = float(match.group(2))
            
            if abs(percentile - 50.0) < 0.1:
                latency_p50.labels(
                    test_type=self.current_test_type,
                    protocol=self.current_protocol,
                    interface=self.current_interface
                ).set(value)
            elif abs(percentile - 99.0) < 0.1:
                latency_p99.labels(
                    test_type=self.current_test_type,
                    protocol=self.current_protocol,
                    interface=self.current_interface
                ).set(value)
            elif abs(percentile - 99.9) < 0.1:
                latency_p999.labels(
                    test_type=self.current_test_type,
                    protocol=self.current_protocol,
                    interface=self.current_interface
                ).set(value)
        
        # Parse throughput
        throughput_match = throughput_pattern.search(content)
        if throughput_match:
            tp = float(throughput_match.group(1))
            throughput.labels(
                test_type=self.current_test_type,
                protocol=self.current_protocol,
                interface=self.current_interface
            ).set(tp)
        
        # Parse packets
        packets_match = packets_pattern.search(content)
        if packets_match:
            sent = int(packets_match.group(1))
            received = int(packets_match.group(2))
            
            # Update counters with the difference from previous values
            packets_sent.labels(
                test_type=self.current_test_type,
                protocol=self.current_protocol,
                interface=self.current_interface
            ).inc(sent)
            
            packets_received.labels(
                test_type=self.current_test_type,
                protocol=self.current_protocol,
                interface=self.current_interface
            ).inc(received)

def main():
    # Start up the server to expose the metrics
    start_http_server(9091)
    print("Sockperf exporter started on port 9091")
    
    # Monitor the log directory
    log_dir = '/var/log/sockperf'
    print(f"Monitoring log directory: {log_dir}")
    
    # Create log directory if it doesn't exist
    os.makedirs(log_dir, exist_ok=True)
    
    event_handler = SockperfLogHandler()
    observer = Observer()
    observer.schedule(event_handler, log_dir, recursive=False)
    observer.start()
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        observer.stop()
    observer.join()

if __name__ == '__main__':
    main()
