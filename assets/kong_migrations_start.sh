#!/usr/bin/env bash

# will (re)start Kong with a clean database, and an optional imported config

kong stop
kong migrations bootstrap --force || exit 1

echo ''
unset KMS_FILENAME
if [ -f /kong-plugin/kong.yml ]; then
    KMS_FILENAME=kong.yml
elif [ -f /kong-plugin/kong.yaml ]; then
    KMS_FILENAME=kong.yaml
elif [ -f /kong-plugin/kong.json ]; then
    KMS_FILENAME=kong.json
fi

if [ ! "$KMS_FILENAME" = "" ]; then
    if [ ! "$1" = "-y" ]; then
        echo "Found file \"$KMS_FILENAME\", import? (y/n, or use \"-y\") "
        old_stty_cfg=$(stty -g)
        stty raw -echo
        answer=$( while ! head -c 1 | grep -i '[ny]' ;do true ;done )
        stty "$old_stty_cfg"
        if ! echo "$answer" | grep -iq "^y" ;then
            echo "Skipping import..."
            unset KMS_FILENAME
        fi
    fi
fi

if [ ! "$KMS_FILENAME" = "" ]; then
    IMPORT_FILE="/kong-plugin/$KMS_FILENAME"
    echo "Importing declarative config from \"$IMPORT_FILE\""
    # run prepare in case: https://github.com/Kong/kong/issues/9365
    kong prepare
    # check for workspace fix
    FILE_WSID=$(lua /pongo/workspace_update.lua < "$IMPORT_FILE")
    if [ ! "$FILE_WSID" = "" ]; then
        echo "File contains workspaces, updating 'default' workspace uuid for import..."
        kong start
        KONG_WSID=$(http :8001/workspaces/default "Kong-Admin-Token:$KONG_PASSWORD" | jq .id)
        kong stop
        echo "Rewriting file; replacing id of 'default' workspace '$FILE_WSID' with '$KONG_WSID'"
        lua /pongo/workspace_update.lua "$KONG_WSID" < "$IMPORT_FILE" > "/tmp/$KMS_FILENAME"
        IMPORT_FILE="/tmp/$KMS_FILENAME"
    fi
    kong config db_import "$IMPORT_FILE"
    if [ $? -ne 0 ]; then
        echo "Failed to import \"$KMS_FILENAME\""
        exit 1
    fi
fi

kong start
