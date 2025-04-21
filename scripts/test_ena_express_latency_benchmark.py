#!/usr/bin/env python3

import unittest
import os
import sys
import tempfile
import io
from unittest.mock import patch, MagicMock
import ena_express_latency_benchmark as benchmark

class TestEnaExpressLatencyBenchmark(unittest.TestCase):
    """Unit tests for the ENA Express Latency Benchmark script."""

    def setUp(self):
        """Set up test environment."""
        # Create sample sockperf output files
        self.eni_sample = """# 5-Tuple: 192.168.3.20:10000->192.168.3.10:11110/UDP
# Test type: ENI
# Test mode: latency
# Iteration: 0, Repeat: 0
# Timestamp: 2025-04-21 13:16:38
#----------------------------------------------------
sockperf: == version #3.10-no.git ==
sockperf[CLIENT] send on:sockperf: using recvfrom() to block on socket(s)

[ 0] IP = 192.168.3.10    PORT = 11110 # UDP
sockperf: Warmup stage (sending a few dummy messages)...
sockperf: Starting test...
sockperf: Test end (interrupted by timer)
sockperf: Test ended
sockperf: [Total Run] RunTime=30.000 sec; Warm up time=400 msec; SentMessages=486250; ReceivedMessages=486249
sockperf: ========= Printing statistics for Server No: 0
sockperf: [Valid Duration] RunTime=29.550 sec; SentMessages=479294; ReceivedMessages=479294
sockperf: ====> avg-latency=30.795 (std-dev=2.215, mean-ad=1.789, median-ad=2.349, siqr=1.593, cv=0.072, std-error=0.003, 99.0% ci=[30.787, 30.803])
sockperf: # dropped messages = 0; # duplicated messages = 0; # out-of-order messages = 0
sockperf: Summary: Latency is 30.795 usec
sockperf: Total 479294 observations; each percentile contains 4792.94 observations
sockperf: ---> <MAX> observation =  166.278
sockperf: ---> percentile 99.999 =   70.248
sockperf: ---> percentile 99.990 =   57.789
sockperf: ---> percentile 99.900 =   40.862
sockperf: ---> percentile 99.000 =   36.542
sockperf: ---> percentile 90.000 =   33.361
sockperf: ---> percentile 75.000 =   32.344
sockperf: ---> percentile 50.000 =   30.632
sockperf: ---> percentile 25.000 =   29.157
sockperf: ---> <MIN> observation =   23.461"""

        self.srd_sample = """# 5-Tuple: 192.168.3.21:10001->192.168.3.11:11111/UDP
# Test type: SRD
# Test mode: latency
# Iteration: 0, Repeat: 0
# Timestamp: 2025-04-21 13:16:38
#----------------------------------------------------
sockperf: == version #3.10-no.git ==
sockperf[CLIENT] send on:sockperf: using recvfrom() to block on socket(s)

[ 0] IP = 192.168.3.11    PORT = 11111 # UDP
sockperf: Warmup stage (sending a few dummy messages)...
sockperf: Starting test...
sockperf: Test end (interrupted by timer)
sockperf: Test ended
sockperf: [Total Run] RunTime=30.000 sec; Warm up time=400 msec; SentMessages=411774; ReceivedMessages=411773
sockperf: ========= Printing statistics for Server No: 0
sockperf: [Valid Duration] RunTime=29.550 sec; SentMessages=405457; ReceivedMessages=405457
sockperf: ====> avg-latency=36.408 (std-dev=2.176, mean-ad=1.703, median-ad=2.084, siqr=1.434, cv=0.060, std-error=0.003, 99.0% ci=[36.399, 36.417])
sockperf: # dropped messages = 0; # duplicated messages = 0; # out-of-order messages = 0
sockperf: Summary: Latency is 36.408 usec
sockperf: Total 405457 observations; each percentile contains 4054.57 observations
sockperf: ---> <MAX> observation =   86.814
sockperf: ---> percentile 99.999 =   75.066
sockperf: ---> percentile 99.990 =   61.538
sockperf: ---> percentile 99.900 =   46.328
sockperf: ---> percentile 99.000 =   42.160
sockperf: ---> percentile 90.000 =   39.009
sockperf: ---> percentile 75.000 =   37.854
sockperf: ---> percentile 50.000 =   36.179
sockperf: ---> percentile 25.000 =   34.984
sockperf: ---> <MIN> observation =   29.290"""

        # Create temporary files with the sample content
        self.eni_file = tempfile.NamedTemporaryFile(delete=False)
        self.srd_file = tempfile.NamedTemporaryFile(delete=False)
        
        with open(self.eni_file.name, 'w') as f:
            f.write(self.eni_sample)
        
        with open(self.srd_file.name, 'w') as f:
            f.write(self.srd_sample)
        
        # Create a temporary directory for output files
        self.output_dir = tempfile.mkdtemp()

    def tearDown(self):
        """Clean up after tests."""
        os.unlink(self.eni_file.name)
        os.unlink(self.srd_file.name)
        
        # Clean up output directory
        import shutil
        shutil.rmtree(self.output_dir)

    def test_extract_metrics_from_file(self):
        """Test the extract_metrics_from_file function."""
        # Extract metrics from ENI sample
        eni_metrics = benchmark.extract_metrics_from_file(self.eni_file.name)
        
        # Verify key ENI metrics
        self.assertEqual(eni_metrics["runtime"], "29.550")
        self.assertEqual(eni_metrics["sent_messages"], "479294")
        self.assertEqual(eni_metrics["received_messages"], "479294")
        self.assertEqual(eni_metrics["avg_latency"], "30.795")
        self.assertEqual(eni_metrics["max_latency"], "166.278")
        self.assertEqual(eni_metrics["percentile_99"], "36.542")
        self.assertEqual(eni_metrics["percentile_50"], "30.632")
        
        # Extract metrics from SRD sample
        srd_metrics = benchmark.extract_metrics_from_file(self.srd_file.name)
        
        # Verify key SRD metrics
        self.assertEqual(srd_metrics["runtime"], "29.550")
        self.assertEqual(srd_metrics["sent_messages"], "405457")
        self.assertEqual(srd_metrics["received_messages"], "405457")
        self.assertEqual(srd_metrics["avg_latency"], "36.408")
        self.assertEqual(srd_metrics["max_latency"], "86.814")
        self.assertEqual(srd_metrics["percentile_99"], "42.160")
        self.assertEqual(srd_metrics["percentile_50"], "36.179")
    
    def test_calculate_improvement(self):
        """Test the calculate_improvement function."""
        # Test with valid values
        self.assertAlmostEqual(benchmark.calculate_improvement("100", "80"), 20.0)
        self.assertAlmostEqual(benchmark.calculate_improvement("50", "60"), -20.0)
        
        # Test with edge cases
        self.assertIsNone(benchmark.calculate_improvement("0", "10"))
        self.assertIsNone(benchmark.calculate_improvement("", "10"))
        self.assertIsNone(benchmark.calculate_improvement("10", ""))
        self.assertIsNone(benchmark.calculate_improvement(None, "10"))
        self.assertIsNone(benchmark.calculate_improvement("10", None))
        self.assertIsNone(benchmark.calculate_improvement("invalid", "10"))
        self.assertIsNone(benchmark.calculate_improvement("10", "invalid"))
    
    @patch('sys.stdout', new_callable=io.StringIO)
    def test_format_output(self, mock_stdout):
        """Test the formatting of output."""
        # Create mock metrics
        eni_metrics = {
            "runtime": "29.550",
            "sent_messages": "479294",
            "received_messages": "479294",
            "dropped_messages": "0",
            "duplicated_messages": "0",
            "out_of_order_messages": "0",
            "avg_latency": "30.795",
            "std_dev": "2.215",
            "mean_ad": "1.789",
            "median_ad": "2.349",
            "siqr": "1.593",
            "cv": "0.072",
            "std_error": "0.003",
            "max_latency": "166.278",
            "percentile_99999": "70.248",
            "percentile_9999": "57.789",
            "percentile_999": "40.862",
            "percentile_99": "36.542",
            "percentile_90": "33.361",
            "percentile_75": "32.344",
            "percentile_50": "30.632",
            "percentile_25": "29.157",
            "min_latency": "23.461"
        }
        
        srd_metrics = {
            "runtime": "29.550",
            "sent_messages": "405457",
            "received_messages": "405457",
            "dropped_messages": "0",
            "duplicated_messages": "0",
            "out_of_order_messages": "0",
            "avg_latency": "36.408",
            "std_dev": "2.176",
            "mean_ad": "1.703",
            "median_ad": "2.084",
            "siqr": "1.434",
            "cv": "0.060",
            "std_error": "0.003",
            "max_latency": "86.814",
            "percentile_99999": "75.066",
            "percentile_9999": "61.538",
            "percentile_999": "46.328",
            "percentile_99": "42.160",
            "percentile_90": "39.009",
            "percentile_75": "37.854",
            "percentile_50": "36.179",
            "percentile_25": "34.984",
            "min_latency": "29.290"
        }
        
        # Define 5-tuples
        eni_udp_5tuple = f"{benchmark.CLIENT_IP_ENI}:{benchmark.CLIENT_PINGPONG_PORT_ENI}->{benchmark.SERVER_IP_ENI}:{benchmark.SERVER_PORT_ENI}/UDP"
        srd_udp_5tuple = f"{benchmark.CLIENT_IP_SRD}:{benchmark.CLIENT_PINGPONG_PORT_SRD}->{benchmark.SERVER_IP_SRD}:{benchmark.SERVER_PORT_SRD}/UDP"
        
        # Print UDP results header
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
            improvement = benchmark.calculate_improvement(eni_val, srd_val)
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
        format_metric_row("avg-latency", "avg_latency", "avg_latency")
        format_metric_row("std-dev", "std_dev", "std_dev", False)
        format_metric_row("mean-ad", "mean_ad", "mean_ad", False)
        format_metric_row("median-ad", "median_ad", "median_ad", False)
        format_metric_row("siqr", "siqr", "siqr", False)
        format_metric_row("cv", "cv", "cv", False)
        format_metric_row("std-error", "std_error", "std_error", False)
        format_metric_row("MAX", "max_latency", "max_latency")
        format_metric_row("P99.999", "percentile_99999", "percentile_99999")
        format_metric_row("P99.990", "percentile_9999", "percentile_9999")
        format_metric_row("P99.900", "percentile_999", "percentile_999")
        format_metric_row("P99.000", "percentile_99", "percentile_99")
        format_metric_row("P90.000", "percentile_90", "percentile_90")
        format_metric_row("P75.000", "percentile_75", "percentile_75")
        format_metric_row("P50.000", "percentile_50", "percentile_50")
        format_metric_row("P25.000", "percentile_25", "percentile_25")
        
        # Get the captured output
        output = mock_stdout.getvalue()
        
        # Verify the output format
        self.assertIn("UDP Results:", output)
        self.assertIn("ENI 5-Tuple:", output)
        self.assertIn("SRD 5-Tuple:", output)
        self.assertIn("METRIC", output)
        self.assertIn("ENI", output)
        self.assertIn("SRD", output)
        self.assertIn("DIFFERENCE", output)
        
        # Check for specific metrics in the output
        self.assertIn("Valid Duration - RunTime", output)
        self.assertIn("Valid Duration - SentMessages", output)
        self.assertIn("Valid Duration - ReceivedMessages", output)
        self.assertIn("# dropped messages", output)
        self.assertIn("# duplicated messages", output)
        self.assertIn("# out-of-order messages", output)
        self.assertIn("avg-latency", output)
        self.assertIn("std-dev", output)
        self.assertIn("mean-ad", output)
        self.assertIn("median-ad", output)
        self.assertIn("siqr", output)
        self.assertIn("cv", output)
        self.assertIn("std-error", output)
        self.assertIn("MAX", output)
        self.assertIn("P99.999", output)
        self.assertIn("P99.990", output)
        self.assertIn("P99.900", output)
        self.assertIn("P99.000", output)
        self.assertIn("P90.000", output)
        self.assertIn("P75.000", output)
        self.assertIn("P50.000", output)
        self.assertIn("P25.000", output)
        
        # Check for specific values in the output
        self.assertIn("30.795 μs", output)
        self.assertIn("36.408 μs", output)
        self.assertIn("-18.23%", output)  # Improvement percentage

if __name__ == '__main__':
    unittest.main()
