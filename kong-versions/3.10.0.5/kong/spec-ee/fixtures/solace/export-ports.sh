#!/bin/bash

# Export Solace docker-compose port environment variables
# Usage: source export-ports.sh or . export-ports.sh

CONTAINER_NAME="solace"

# Check if container is running
if ! docker ps --format "table {{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: Container ${CONTAINER_NAME} is not running. Please start the container first: docker-compose up -d" >&2
    return 1 2>/dev/null || exit 1
fi

# When this script is called from docker-compose, write only env vars to stdout
# Echo messages go to stderr so they don't interfere with the .env.solace file
echo "Exporting Solace port environment variables..." >&2

# Get dynamically allocated ports and export
# Output with 'export' prefix for .env.solace file

# Web transport (8008)
export KONG_SPEC_TEST_SOLACE_WEB_TRANSPORT_PORT_8008=$(docker port $CONTAINER_NAME 8008/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_WEB_TRANSPORT_PORT_8008=$KONG_SPEC_TEST_SOLACE_WEB_TRANSPORT_PORT_8008"

# Web transport over TLS (1443)
export KONG_SPEC_TEST_SOLACE_WEB_TRANSPORT_TLS_PORT_1443=$(docker port $CONTAINER_NAME 1443/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_WEB_TRANSPORT_TLS_PORT_1443=$KONG_SPEC_TEST_SOLACE_WEB_TRANSPORT_TLS_PORT_1443"

# SEMP over TLS (1943)
export KONG_SPEC_TEST_SOLACE_SEMP_TLS_PORT_1943=$(docker port $CONTAINER_NAME 1943/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_SEMP_TLS_PORT_1943=$KONG_SPEC_TEST_SOLACE_SEMP_TLS_PORT_1943"

# MQTT Default VPN (1883)
export KONG_SPEC_TEST_SOLACE_MQTT_PORT_1883=$(docker port $CONTAINER_NAME 1883/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_MQTT_PORT_1883=$KONG_SPEC_TEST_SOLACE_MQTT_PORT_1883"

# AMQP Default VPN over TLS (5671)
export KONG_SPEC_TEST_SOLACE_AMQP_TLS_PORT_5671=$(docker port $CONTAINER_NAME 5671/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_AMQP_TLS_PORT_5671=$KONG_SPEC_TEST_SOLACE_AMQP_TLS_PORT_5671"

# AMQP Default VPN (5672)
export KONG_SPEC_TEST_SOLACE_AMQP_PORT_5672=$(docker port $CONTAINER_NAME 5672/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_AMQP_PORT_5672=$KONG_SPEC_TEST_SOLACE_AMQP_PORT_5672"

# MQTT Default VPN over WebSockets (8000)
export KONG_SPEC_TEST_SOLACE_MQTT_WS_PORT_8000=$(docker port $CONTAINER_NAME 8000/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_MQTT_WS_PORT_8000=$KONG_SPEC_TEST_SOLACE_MQTT_WS_PORT_8000"

# MQTT Default VPN over WebSockets / TLS (8443)
export KONG_SPEC_TEST_SOLACE_MQTT_WSS_PORT_8443=$(docker port $CONTAINER_NAME 8443/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_MQTT_WSS_PORT_8443=$KONG_SPEC_TEST_SOLACE_MQTT_WSS_PORT_8443"

# MQTT Default VPN over TLS (8883)
export KONG_SPEC_TEST_SOLACE_MQTT_TLS_PORT_8883=$(docker port $CONTAINER_NAME 8883/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_MQTT_TLS_PORT_8883=$KONG_SPEC_TEST_SOLACE_MQTT_TLS_PORT_8883"

# SEMP / PubSub+ Manager (8080)
export KONG_SPEC_TEST_SOLACE_SEMP_PORT_8080=$(docker port $CONTAINER_NAME 8080/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_SEMP_PORT_8080=$KONG_SPEC_TEST_SOLACE_SEMP_PORT_8080"

# REST Default VPN (9000)
export KONG_SPEC_TEST_SOLACE_REST_PORT_9000=$(docker port $CONTAINER_NAME 9000/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_REST_PORT_9000=$KONG_SPEC_TEST_SOLACE_REST_PORT_9000"

# REST Default VPN over TLS (9443)
export KONG_SPEC_TEST_SOLACE_REST_TLS_PORT_9443=$(docker port $CONTAINER_NAME 9443/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_REST_TLS_PORT_9443=$KONG_SPEC_TEST_SOLACE_REST_TLS_PORT_9443"

# SMF (55555)
export KONG_SPEC_TEST_SOLACE_SMF_PORT_55555=$(docker port $CONTAINER_NAME 55555/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_SMF_PORT_55555=$KONG_SPEC_TEST_SOLACE_SMF_PORT_55555"

# SMF Compressed (55003)
export KONG_SPEC_TEST_SOLACE_SMF_COMPRESSED_PORT_55003=$(docker port $CONTAINER_NAME 55003/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_SMF_COMPRESSED_PORT_55003=$KONG_SPEC_TEST_SOLACE_SMF_COMPRESSED_PORT_55003"

# SMF over TLS (55443)
export KONG_SPEC_TEST_SOLACE_SMF_TLS_PORT_55443=$(docker port $CONTAINER_NAME 55443/tcp | cut -d: -f2)
echo "export KONG_SPEC_TEST_SOLACE_SMF_TLS_PORT_55443=$KONG_SPEC_TEST_SOLACE_SMF_TLS_PORT_55443"

# Webhook logs directory path
export KONG_SPEC_TEST_SOLACE_WEBHOOK_LOGS_PATH="$KONG_SPEC_TEST_SOLACE_WEBHOOK_LOGS_PATH"
echo "export KONG_SPEC_TEST_SOLACE_WEBHOOK_LOGS_PATH=$KONG_SPEC_TEST_SOLACE_WEBHOOK_LOGS_PATH"

# MQTT consumer logs directory path
export KONG_SPEC_TEST_SOLACE_MQTT_LOGS_PATH="$KONG_SPEC_TEST_SOLACE_MQTT_LOGS_PATH"
echo "export KONG_SPEC_TEST_SOLACE_MQTT_LOGS_PATH=$KONG_SPEC_TEST_SOLACE_MQTT_LOGS_PATH"

# Output informational messages to stderr so they don't go into .env.solace
echo "" >&2
echo "All port environment variables have been exported successfully!" >&2
echo "Usage examples:" >&2
echo "  curl http://localhost:\$KONG_SPEC_TEST_SOLACE_SEMP_PORT_8080" >&2