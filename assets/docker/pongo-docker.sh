#!/usr/bin/env bash

# Any parameters passed to this script will be passed to Pongo inside
# the container.
#
# var PONGO_PLUGIN_SOURCE should point to the directory where
# the plugin source is located (top-level of repo). Defaults
# to the current directory.
#
# set var PONGO_VERSION for the version of Pongo to use,
# defaults to 'master' for the master branch.

function main {
  # get plugin source location, default to PWD
  if [[ -z $PONGO_PLUGIN_SOURCE ]]; then
    PONGO_PLUGIN_SOURCE=.
  fi
  PONGO_PLUGIN_SOURCE=$(realpath "$PONGO_PLUGIN_SOURCE")

  if [[ -z $PONGO_VERSION ]]; then
    # building master branch, tag 'latest'
    PONGO_VERSION=latest
  fi

  # run the command
  docker run -t --rm \
    -v "/var/run/docker.sock:/var/run/docker.sock" \
    -v "$PONGO_PLUGIN_SOURCE:/pongo_wd" \
    --cidfile "$PONGO_PLUGIN_SOURCE/.containerid" \
    "pongo:$PONGO_VERSION" "$@"

  local result=$?

  rm "$PONGO_PLUGIN_SOURCE/.containerid"

  exit $result
}

main "$@"
