FROM python:3.12-slim

# ffmpeg + yt-dlp enable the optional "download" button (opt-in per link).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-download.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-download.txt

COPY server.py netguard.py scrapling_adapter.py downloader.py agent_bridge.py dj_agent.py ./
COPY static ./static

# SYNKLAB_IN_CONTAINER lets the local-only endpoints accept Docker's bridge address.
# Always publish the port on the host loopback only: -p 127.0.0.1:8000:8000
ENV PYTHONUNBUFFERED=1 \
    SYNKLAB_IN_CONTAINER=1 \
    SYNKLAB_INBOX=/data/inbox \
    XDG_CACHE_HOME=/tmp/.cache \
    HOME=/tmp

RUN mkdir -p /data/inbox && chmod 777 /data/inbox
USER 1000:1000
VOLUME /data/inbox
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/agent/status', timeout=4).status==200 else 1)"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
