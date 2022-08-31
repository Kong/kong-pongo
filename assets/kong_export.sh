#!/bin/sh

# export the kong configuration to "kong.yml"


echo ''
if [ -f /kong-plugin/kong.yml ]; then
    if [ ! "$1" = "-y" ]; then
        echo "The file \"kong.yml\" already exists, overwrite? (y/n, or use \"-y\") "
        old_stty_cfg=$(stty -g)
        stty raw -echo
        answer=$( while ! head -c 1 | grep -i '[ny]' ;do true ;done )
        stty "$old_stty_cfg"
        if ! echo "$answer" | grep -iq "^y" ;then
            exit 0
        fi
    fi
fi


echo "Exporting declarative config to \"kong.yml\"..."
kong config db_export /kong-plugin/kong.yml
if [ $? -ne 0 ]; then
    echo "Failed to export to \"kong.yml\""
    exit 1
fi
echo "Export to \"kong.yml\" complete."
