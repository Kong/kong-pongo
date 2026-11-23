# PostgreSQL 18 with OAUTHBEARER (pg_oidc_validator) support
# For Kong PostgreSQL OAuth integration testing
#
# This image includes:
# - PostgreSQL 18
# - pg_oidc_validator extension from Percona-Lab

FROM postgres:18

ARG TARGETARCH

# Install dependencies and pg_oidc_validator
# The pre-built .deb is amd64-only; on arm64 we build from source.
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    curl \
    ca-certificates \
    openssl \
    && if [ "$TARGETARCH" = "arm64" ]; then \
      apt-get install -y --no-install-recommends \
        build-essential \
        g++ \
        git \
        libcurl4-openssl-dev \
        libjson-c-dev \
        postgresql-server-dev-18 \
      && git clone --depth 1 --branch latest https://github.com/Percona-Lab/pg_oidc_validator.git /tmp/pg-oidc-validator \
      && make -C /tmp/pg-oidc-validator USE_PGXS=1 install -j \
      && rm -rf /tmp/pg-oidc-validator ; \
    else \
      wget -q https://github.com/Percona-Lab/pg_oidc_validator/releases/download/latest/pg-oidc-validator-pgdg18.deb -O /tmp/pg-oidc-validator.deb \
      && dpkg -i /tmp/pg-oidc-validator.deb \
      && rm /tmp/pg-oidc-validator.deb ; \
    fi \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy initialization script
COPY init-oauth.sh /docker-entrypoint-initdb.d/

# Expose PostgreSQL port
EXPOSE 5432
