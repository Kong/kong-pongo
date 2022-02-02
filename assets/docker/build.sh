#!/usr/bin/env bash

# set var PONGO_VERSION for the version of Pongo to build,
# defaults to 'master' for the master branch

function main {

  TAG=$PONGO_VERSION
  if [[ -z $PONGO_VERSION ]]; then
    # building master branch, tag 'latest'
    TAG=latest
  else
    TAG=$PONGO_VERSION
  fi

  # where is this script located, to enable finding the Dockerfile
  local script_path
  script_path=$(test -L "$0" && readlink "$0" || echo "$0")
  LOCAL_PATH=$(dirname "$(realpath "$script_path")")

  # build the Pongo-docker image
  docker build --tag="pongo:$TAG" --build-arg PONGO_VERSION \
    -f "$LOCAL_PATH/Dockerfile" .
}

main "$@"
