#!/bin/sh

# Read from environment variables, default admin/admin
AUTH="${ADMIN_USERNAME:-admin}:${ADMIN_PASSWORD:-admin}"

SEMP_URL="http://solace:8080/SEMP/v2/config"

CERT_PATH="/certs/cert.pem"
KEY_PATH="/certs/key.pem"

echo "Waiting for Solace Broker to start..."

# Wait for SEMP API to be available
MAX_ATTEMPTS=30
ATTEMPT=0

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    echo "Attempt $((ATTEMPT + 1))/$MAX_ATTEMPTS: Checking if SEMP API is available..."
    
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" "$SEMP_URL" 2>/dev/null)
    
    if [ "$HTTP_STATUS" = "200" ]; then
        echo "SEMP API is available!"
        break
    fi
    
    echo "   SEMP API not ready yet (HTTP: $HTTP_STATUS), waiting 10 seconds..."
    sleep 10
    ATTEMPT=$((ATTEMPT + 1))
done

if [ $ATTEMPT -eq $MAX_ATTEMPTS ]; then
    echo "SEMP API failed to become available after $MAX_ATTEMPTS attempts"
    exit 1
fi

echo "Checking certificate files..."
if [ ! -f "$CERT_PATH" ]; then
  echo "Error: Certificate file not found at $CERT_PATH"
  exit 1
fi
if [ ! -f "$KEY_PATH" ]; then
  echo "Error: Private key file not found at $KEY_PATH"
  exit 1
fi
echo "Certificate files found"

echo "Configuring TLS certificates..."

# For Solace, we need to configure the server certificate properly
# Read certificate and key content
CERT_CONTENT=$(cat "$CERT_PATH")
KEY_CONTENT=$(cat "$KEY_PATH")

# Create a combined PEM file (cert + key) as Solace expects
COMBINED_PEM="${CERT_CONTENT}
${KEY_CONTENT}"

# Encode for JSON (escape newlines)
COMBINED_PEM_ESCAPED=$(echo "$COMBINED_PEM" | sed ':a;N;$!ba;s/\n/\\n/g')

echo "Configuring server certificate..."

# Configure the server certificate using the correct SEMP API
BROKER_CONFIG_URL="http://solace:8080/SEMP/v2/config"

# Set the TLS server certificate
CERT_CONFIG="{
  \"tlsServerCertContent\": \"$COMBINED_PEM_ESCAPED\"
}"

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" -X PATCH "$BROKER_CONFIG_URL" \
  -H "Content-Type: application/json" \
  -d "$CERT_CONFIG")

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "204" ]; then
  echo "Server certificate configured (HTTP: $HTTP_STATUS)"
else
  echo "Server certificate configuration returned HTTP: $HTTP_STATUS"
  # Try to get error details
  RESPONSE=$(curl -s -u "$AUTH" -X PATCH "$BROKER_CONFIG_URL" \
    -H "Content-Type: application/json" \
    -d "$CERT_CONFIG")
  echo "Response: $RESPONSE"
fi

# Enable TLS on various services
echo "Enabling TLS on services..."

# Enable TLS on default message VPN
VPN_CONFIG_URL="http://solace:8080/SEMP/v2/config/msgVpns/default"

TLS_CONFIG='{
  "serviceSmfTlsEnabled": true,
  "serviceWebTlsEnabled": true,
  "serviceMqttTlsEnabled": true,
  "serviceRestIncomingTlsEnabled": true
}'

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -u "$AUTH" -X PATCH "$VPN_CONFIG_URL" \
  -H "Content-Type: application/json" \
  -d "$TLS_CONFIG")

if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "204" ]; then
  echo "TLS services enabled successfully"
else
  echo "Failed to enable TLS services. HTTP status: $HTTP_STATUS"
  # Get detailed error
  curl -s -u "$AUTH" -X PATCH "$VPN_CONFIG_URL" \
    -H "Content-Type: application/json" \
    -d "$TLS_CONFIG"
  exit 1
fi

echo "TLS configuration completed successfully!"
