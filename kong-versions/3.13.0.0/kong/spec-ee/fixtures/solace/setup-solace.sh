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

echo "Checking Solace container logs..."
docker compose -p solace logs

echo "Waiting for solace-setup container to complete generating .env.solace..."
while docker ps --filter "name=solace-setup" --filter "status=running" --format "table {{.Names}}" | grep -q solace-setup; do
  echo "Setup still running..."
  sleep 2
done
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
