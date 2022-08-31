#!/bin/sh

# will (re)start Kong DBless from a config file; kong.y(a)ml/json

unset KDBL_FILENAME
if [ -f /kong-plugin/kong.yml ]; then
    KDBL_FILENAME=kong.yml
elif [ -f /kong-plugin/kong.yaml ]; then
    KDBL_FILENAME=kong.yaml
elif [ -f /kong-plugin/kong.json ]; then
    KDBL_FILENAME=kong.json
else
    echo 'Error: Declarative file "kong.yml/yaml/json" not found';
    exit 1
fi

KONG_DATABASE=off KONG_DECLARATIVE_CONFIG=/kong-plugin/$KDBL_FILENAME kong restart
