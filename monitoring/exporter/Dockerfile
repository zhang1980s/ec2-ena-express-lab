FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY sockperf_exporter.py .
RUN chmod +x sockperf_exporter.py

EXPOSE 9091

CMD ["python", "sockperf_exporter.py"]
