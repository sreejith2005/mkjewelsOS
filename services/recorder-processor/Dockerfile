FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y --no-install-recommends python3.11 python3-pip && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN python3.11 -m pip install --no-cache-dir -r requirements.txt
COPY processor.py engines.py production.py ./
# Model weights download to this cache on first start; mount a private volume to keep them.
ENV HF_HOME=/models
USER 65532:65532
# Private network only: the recorder worker is the only client. TLS terminates at the private load balancer.
CMD ["python3.11", "-m", "uvicorn", "production:app", "--factory", "--host", "0.0.0.0", "--port", "8443", "--no-access-log", "--limit-concurrency", "8", "--timeout-keep-alive", "5"]
