#!/usr/bin/env bash

# if no file `.pongo/pongo-setup.sh` is found, then this file contains
# the default setup actions.

cd /kong-plugin || { echo "Failure to enter /kong-plugin"; exit 1; }

# loop over all rockspecs found
# shellcheck disable=SC2044  #rockspecs do not contain spaces anyway
for rockspec in $(find /kong-plugin -maxdepth 1 -type f -name '*.rockspec'); do
  rockname=$(echo "$rockspec" | sed "s/\/kong-plugin\///" | sed "s/-[0-9a-zA-Z.]*-[0-9].rockspec//")
  # remove the rock if another version is already installed
  if luarocks list | grep "^$rockname$" ; then
    luarocks remove --force "$rockname"
  fi
  # install any required dependencies
  luarocks install --only-deps "$rockspec" EXPAT_DIR=/usr/local/kong LIBXML2_DIR=/usr/local/kong
done

