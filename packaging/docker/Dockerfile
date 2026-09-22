FROM python:3.12-slim

LABEL maintainer="Omarchy Team <dev@omarchy.local>"
LABEL description="Omarchy GPU Session Broker & Zero-SSH REST API Daemon"

# Install runtime dependencies (sqlite3, curl for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    curl \
    procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy scripts
COPY scripts/omarchy-session-broker /usr/local/bin/omarchy-session-broker
COPY scripts/omarchy-setup /usr/local/bin/omarchy-setup
COPY scripts/omarchy-wolf-network-isolation /usr/local/bin/omarchy-wolf-network-isolation

RUN chmod +x /usr/local/bin/omarchy-* && \
    mkdir -p /var/lib/omarchy

VOLUME ["/var/lib/omarchy", "/mnt/nas-recordings"]

EXPOSE 47995

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
    CMD curl -f http://127.0.0.1:47995/api/health || exit 1

ENTRYPOINT ["/usr/local/bin/omarchy-session-broker"]
CMD ["daemon", "--port", "47995"]
