#!/usr/bin/env bash
# Script to run pg-oauth integration tests locally
#
# Usage:
#   ./spec-ee/fixtures/pg-oauth/run-tests.sh [options] [test-file]
#
# Options:
#   --bootstrap    Force run migrations bootstrap (default: auto-detect)
#   --no-bootstrap Skip migrations bootstrap
#   --start-only   Only start the environment, don't run tests
#   --stop         Stop the environment and exit
#   --help         Show this help message
#
# Examples:
#   ./spec-ee/fixtures/pg-oauth/run-tests.sh                    # Run all pg-oauth tests
#   ./spec-ee/fixtures/pg-oauth/run-tests.sh --bootstrap        # Force bootstrap and run tests
#   ./spec-ee/fixtures/pg-oauth/run-tests.sh 01-oauth           # Run specific test file
#   ./spec-ee/fixtures/pg-oauth/run-tests.sh --start-only       # Just start environment
#   ./spec-ee/fixtures/pg-oauth/run-tests.sh --stop             # Stop environment

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KONG_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yaml"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default options
DO_BOOTSTRAP="auto"
START_ONLY=false
STOP_ONLY=false
TEST_FILE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --bootstrap)
            DO_BOOTSTRAP="yes"
            shift
            ;;
        --no-bootstrap)
            DO_BOOTSTRAP="no"
            shift
            ;;
        --start-only)
            START_ONLY=true
            shift
            ;;
        --stop)
            STOP_ONLY=true
            shift
            ;;
        --help|-h)
            head -25 "$0" | tail -22
            exit 0
            ;;
        *)
            TEST_FILE="$1"
            shift
            ;;
    esac
done

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Stop environment
stop_environment() {
    log_info "Stopping pg-oauth environment..."
    docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true
}

# Handle --stop option
if [ "$STOP_ONLY" = true ]; then
    stop_environment
    log_info "Environment stopped."
    exit 0
fi

cd "$KONG_ROOT"

# Step 1: Check/add hosts entry
log_info "Checking /etc/hosts for 'keycloak' entry..."
if ! grep -q "127.0.0.1.*keycloak" /etc/hosts; then
    log_warn "'keycloak' not found in /etc/hosts. Adding it (requires sudo)..."
    echo "127.0.0.1 keycloak" | sudo tee -a /etc/hosts
    log_info "Added '127.0.0.1 keycloak' to /etc/hosts"
else
    log_info "'keycloak' already in /etc/hosts"
fi

# Step 2: Start docker compose environment
log_info "Starting pg-oauth environment (Keycloak:28080 + PostgreSQL:25432)..."
docker compose -f "$COMPOSE_FILE" up -d --wait

# Step 3: Wait for Keycloak realm to be ready
log_info "Waiting for Keycloak pg-oauth realm to be ready..."
MAX_WAIT=60
for i in $(seq 1 $MAX_WAIT); do
    if curl -sf http://localhost:28080/realms/pg-oauth > /dev/null 2>&1; then
        log_info "Keycloak pg-oauth realm is ready!"
        break
    fi
    if [ $i -eq $MAX_WAIT ]; then
        log_error "Keycloak realm not ready after ${MAX_WAIT}s"
        docker compose -f "$COMPOSE_FILE" logs
        exit 1
    fi
    sleep 1
done

# Handle --start-only option
if [ "$START_ONLY" = true ]; then
    log_info "Environment started. Services:"
    echo "  - Keycloak: http://localhost:28080 (admin/test)"
    echo "  - PostgreSQL: localhost:25432 (pguser/pgpass, database: kong_oauth_test)"
    echo ""
    echo "To run tests manually:"
    echo "  bin/busted spec-ee/02-integration/27-pg-oauth/"
    echo ""
    echo "To stop:"
    echo "  $0 --stop"
    exit 0
fi

# Step 4: Bootstrap Kong database (if needed)
run_bootstrap() {
    log_info "Running Kong migrations bootstrap on pg-oauth PostgreSQL..."
    KONG_DATABASE=postgres \
    KONG_PG_HOST=127.0.0.1 \
    KONG_PG_PORT=25432 \
    KONG_PG_DATABASE=kong_oauth_test \
    KONG_PG_USER=pguser \
    KONG_PG_SSL=on \
    KONG_PG_SSL_VERIFY=on \
    KONG_PG_OAUTH_AUTH=on \
    KONG_PG_OAUTH_CLIENT_ID=kong-pg-client \
    KONG_PG_OAUTH_CLIENT_SECRET=kong-pg-client-secret \
    KONG_PG_OAUTH_TOKEN_ENDPOINT=http://keycloak:28080/realms/pg-oauth/protocol/openid-connect/token \
    KONG_PG_OAUTH_SCOPE=openid \
    bin/kong migrations bootstrap --force
}

if [ "$DO_BOOTSTRAP" = "yes" ]; then
    run_bootstrap
elif [ "$DO_BOOTSTRAP" = "auto" ]; then
    # Check if migrations are needed by trying to connect and check schema_meta table
    log_info "Checking if migrations bootstrap is needed..."
    if docker exec pg-oauth-postgres psql -U pguser -d kong_oauth_test -c "SELECT * FROM schema_meta LIMIT 1" > /dev/null 2>&1; then
        log_info "Database already bootstrapped, skipping migrations."
    else
        log_warn "Database not bootstrapped, running migrations..."
        run_bootstrap
    fi
else
    log_info "Skipping migrations bootstrap (--no-bootstrap)"
fi

# Step 5: Run tests
log_info "Running pg-oauth tests..."
echo ""

if [ -n "$TEST_FILE" ]; then
    # Find matching test file
    MATCHING_FILES=$(find spec-ee/02-integration/27-pg-oauth -name "*${TEST_FILE}*.lua" -type f 2>/dev/null)
    if [ -z "$MATCHING_FILES" ]; then
        log_error "No test file matching '$TEST_FILE' found"
        exit 1
    fi
    bin/busted $MATCHING_FILES
else
    bin/busted spec-ee/02-integration/27-pg-oauth/
fi

echo ""
log_info "Tests completed!"
echo ""
echo "To stop the environment: $0 --stop"
