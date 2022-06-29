#!/bin/sh

# will (re)start Kong with a clean database, and an optional imported config

kong stop
kong migrations bootstrap --force

echo ''
unset KMS_FILENAME
if [ -f /kong-plugin/kong.yaml ]; then
    KMS_FILENAME=kong.yaml
elif [ -f /kong-plugin/kong.yml ]; then
    KMS_FILENAME=kong.yml
elif [ -f /kong-plugin/kong.json ]; then
    KMS_FILENAME=kong.json
fi
# fi

if [ "$KMS_FILENAME" = "" ]; then
    echo 'Declarative file "kong.yaml/yml/json" not found, skipping import'
else
    echo "Found \"$KMS_FILENAME\", importing declarative config..."
    kong config db_import /kong-plugin/$KMS_FILENAME
    if [ $? -ne 0 ]; then
        echo "Failed to import \"$KMS_FILENAME\""
        exit 1
    fi
fi

kong start
