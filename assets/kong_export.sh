#!/bin/sh

# export the kong configuration to "kong.yml"

KX_FILENAME=/kong-plugin/kong.yml
echo ''
if [ -f $KX_FILENAME ]; then
    if [ ! "$1" = "-y" ]; then
        echo "The file \"$KX_FILENAME\" already exists, overwrite? (y/n, or use \"-y\") "
        old_stty_cfg=$(stty -g)
        stty raw -echo
        answer=$( while ! head -c 1 | grep -i '[ny]' ;do true ;done )
        stty "$old_stty_cfg"
        if ! echo "$answer" | grep -iq "^y" ;then
            exit 0
        fi
    fi
    rm $KX_FILENAME
fi


echo "Exporting declarative config to \"$KX_FILENAME\"..."
kong config db_export $KX_FILENAME
if [ $? -ne 0 ]; then
    echo "Failed to export to \"$KX_FILENAME\""
    exit 1
fi
echo "Export to \"$KX_FILENAME\" complete."
