FROM python:3.14-slim
WORKDIR /app
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY recorder.py adapters.py worker.py production.py transcript.py redact.py contracts.py prompts.py analysis.py ./
USER 65532:65532
# TLS proxy lives on same trusted network; change forwarded IP only to exact proxy CIDR.
CMD ["uvicorn", "production:app", "--factory", "--host", "127.0.0.1", "--port", "8080", "--proxy-headers", "--forwarded-allow-ips", "127.0.0.1", "--no-access-log", "--ws-max-size", "90000", "--ws-max-queue", "2", "--limit-concurrency", "128", "--timeout-keep-alive", "5"]
