#!/bin/bash
set -e

# PostgreSQL 18 OAUTHBEARER initialization script
# This runs inside the PostgreSQL container during first startup
# Following pgmoon's test setup: https://github.com/Kong/pgmoon/pull/37

echo "=== Initializing PostgreSQL 18 with OAUTHBEARER support ==="

# Get configuration from environment (set by docker-compose)
KEYCLOAK_HOST="${KEYCLOAK_HOST:-host.docker.internal}"
KEYCLOAK_PORT="${KEYCLOAK_PORT:-28080}"
REALM_NAME="${REALM_NAME:-pg-oauth}"
# For password grant with username-sub-mapper, the sub claim = username
# DB_USER must match the 'sub' claim in the OAuth token (which is now the username)
DB_USER="${DB_USER:-pguser}"

# Use HTTP for local testing (Keycloak dev mode)
ISSUER_URL="http://${KEYCLOAK_HOST}:${KEYCLOAK_PORT}/realms/${REALM_NAME}"

echo "ISSUER_URL: $ISSUER_URL"
echo "DB_USER: $DB_USER"

# Generate self-signed SSL certificate for test environment
echo "=== Generating SSL certificates ==="
openssl req -new -x509 -days 365 -nodes \
    -out "$PGDATA/server.crt" \
    -keyout "$PGDATA/server.key" \
    -subj "/CN=pg-oauth-test"
chmod 600 "$PGDATA/server.key"
chown postgres:postgres "$PGDATA/server.crt" "$PGDATA/server.key"

# Configure SSL in postgresql.conf directly (not ALTER SYSTEM)
# This ensures SSL is enabled immediately after init
echo "" >> "$PGDATA/postgresql.conf"
echo "# SSL configuration for OAuth testing" >> "$PGDATA/postgresql.conf"
echo "ssl = on" >> "$PGDATA/postgresql.conf"
echo "ssl_cert_file = 'server.crt'" >> "$PGDATA/postgresql.conf"
echo "ssl_key_file = 'server.key'" >> "$PGDATA/postgresql.conf"
echo "max_connections = 5000" >> "$PGDATA/postgresql.conf"
echo "shared_preload_libraries = 'pg_oidc_validator'" >> "$PGDATA/postgresql.conf"
echo "oauth_validator_libraries = 'pg_oidc_validator'" >> "$PGDATA/postgresql.conf"

# Create database user (must match Keycloak service account 'sub' claim)
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create user for OAuth authentication (matches Keycloak service account sub)
    CREATE ROLE "${DB_USER}" WITH LOGIN SUPERUSER;
    GRANT ALL PRIVILEGES ON DATABASE ${POSTGRES_DB} TO "${DB_USER}";
    GRANT ALL ON SCHEMA public TO "${DB_USER}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${DB_USER}";
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${DB_USER}";

    -- Create test table for integration tests
    CREATE TABLE IF NOT EXISTS oauth_test (
        id SERIAL PRIMARY KEY,
        data TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO oauth_test (data) VALUES ('test1'), ('test2'), ('test3');

    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${DB_USER}";
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${DB_USER}";
EOSQL

echo "=== Configuring pg_hba.conf for OAUTHBEARER ==="

# Configure pg_hba.conf for OAuth authentication
# Format must match pgmoon's test setup: issuer=... scope=...
# See: https://github.com/Kong/pgmoon/blob/feature/oauthbearer-support/oauth_examples/setup.sh
cat > "$PGDATA/pg_hba.conf" <<EOF
# TYPE  DATABASE        USER            ADDRESS                 METHOD        OPTIONS
local   all             all                                     trust
host    all             postgres        all                     trust
host    all             all             all                     oauth         issuer=${ISSUER_URL} scope=openid
EOF

echo "=== PostgreSQL 18 OAuth initialization complete ==="
