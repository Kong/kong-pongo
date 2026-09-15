#!/bin/bash

# Setup Solace for testing
# This script starts Solace containers and exports port environment variables

set -e

WORKSPACE_DIR="${1:-$GITHUB_WORKSPACE}"
SOLACE_COMPOSE_FILE="$WORKSPACE_DIR/spec-ee/fixtures/solace/solace.yaml"
EXPORT_PORTS_SCRIPT="$WORKSPACE_DIR/spec-ee/fixtures/solace/scripts/export-ports.sh"

echo "Starting Solace containers..."
docker compose -f "$SOLACE_COMPOSE_FILE" up -d

if [ -n "$GITHUB_ENV" ]; then
  echo "SKIP_SOLACE_START=true" >> $GITHUB_ENV
else
  export SKIP_SOLACE_START=true
fi

echo "Waiting for the solace-setup container to finish..."
# `docker wait` blocks until the container exits and prints its exit code.
# The previous loop polled `docker ps` and never looked at the exit code, so
# a failed setup looked the same as a successful one.
if ! SETUP_EXIT_CODE=$(docker wait solace-setup 2>&1); then
  echo "ERROR: cannot wait for the solace-setup container: $SETUP_EXIT_CODE"
  docker compose -f "$SOLACE_COMPOSE_FILE" ps -a
  exit 1
fi

# Print these logs only now. The previous `docker compose logs` call ran
# before solace-setup had started, so its output was never captured.
echo "solace-setup logs:"
docker logs solace-setup 2>&1 | sed 's/^/  | /'

if [ "$SETUP_EXIT_CODE" != "0" ]; then
  echo "ERROR: solace-setup exited with code $SETUP_EXIT_CODE."
  echo "The broker did not get its TLS configuration, so every tcps:// test would fail."
  docker compose -f "$SOLACE_COMPOSE_FILE" ps -a
  exit 1
fi
echo "Solace setup completed!"

echo "Exporting Solace port environment variables..."
if [ -f "$EXPORT_PORTS_SCRIPT" ]; then
  # Generate .env.solace file first
  ENV_SOLACE_FILE="$WORKSPACE_DIR/spec-ee/fixtures/solace/.env.solace"
  echo "Generating .env.solace file at $ENV_SOLACE_FILE..."
  
  # Create the directory if it doesn't exist
  mkdir -p "$(dirname "$ENV_SOLACE_FILE")"
  
  # Generate .env.solace file by running export-ports.sh
  cd "$WORKSPACE_DIR/spec-ee/fixtures/solace"
  "$EXPORT_PORTS_SCRIPT" > .env.solace
  
  # Now source the generated .env.solace file to set environment variables
  echo "Sourcing .env.solace to set environment variables..."
  source .env.solace
  echo "Port environment variables exported successfully!"
  
  echo "All Solace environment variables exported!"
else
  echo "Warning: export-ports.sh script not found at $EXPORT_PORTS_SCRIPT"
fi

# The broker accepts TCP on the SMF TLS port even when it has no server
# certificate, and then resets every handshake. A plain port check therefore
# passes while each tcps:// test fails with "unexpected eof while reading".
# Complete a real TLS handshake instead. A successful handshake makes
# openssl print the server certificate.
wait_for_smf_tls() {
  local port="$1"
  local attempt=0

  while [ "$attempt" -lt 60 ]; do
    if echo | timeout 10 openssl s_client -connect "127.0.0.1:${port}" 2>/dev/null \
      | grep -q "BEGIN CERTIFICATE"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done

  return 1
}

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is missing. It is required to verify the Solace SMF TLS listener."
  exit 1
fi

if [ -z "${KONG_SPEC_TEST_SOLACE_SMF_TLS_PORT_55443:-}" ]; then
  echo "ERROR: KONG_SPEC_TEST_SOLACE_SMF_TLS_PORT_55443 is not set. The port export step failed."
  exit 1
fi

echo "Waiting for the Solace SMF TLS listener on port $KONG_SPEC_TEST_SOLACE_SMF_TLS_PORT_55443..."
if ! wait_for_smf_tls "$KONG_SPEC_TEST_SOLACE_SMF_TLS_PORT_55443"; then
  echo "ERROR: the Solace SMF TLS listener does not complete a TLS handshake."
  echo "The broker most probably has no server certificate. Check the solace-setup logs above."
  docker compose -f "$SOLACE_COMPOSE_FILE" logs solace
  exit 1
fi
echo "Solace SMF TLS listener is ready."

# Display the contents of .env.solace file if it exists
ENV_SOLACE_FILE="$WORKSPACE_DIR/spec-ee/fixtures/solace/.env.solace"
if [ -f "$ENV_SOLACE_FILE" ]; then
  echo "Contents of .env.solace:"
  echo "========================"
  cat "$ENV_SOLACE_FILE"
  echo "========================"
else
  echo "Warning: .env.solace file not found at $ENV_SOLACE_FILE"
fi

echo "Solace setup completed successfully!"
