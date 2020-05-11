#!/bin/bash

# this requires LOCAL_PATH to be set to the Pongo directory

# special case accepted version identifiers
NIGHTLY_CE=nightly
NIGHTLY_EE=nightly-ee

function err {
  >&2 echo -e "\033[0;31m[pongo-ERROR] $@\033[0m"
  exit 1
}


function warn {
  >&2 echo -e "\033[0;33m[pongo-WARN] $@\033[0m"
}


function msg {
  >&2 echo -e "\033[0;36m[pongo-INFO] $@\033[0m"
}


# read config from Pongo RC file
if [[ -f $PONGORC_FILE ]]; then
  IFS=$'\r\n' GLOBIGNORE='*' command eval  'PONGORC_ARGS=($(cat $PONGORC_FILE))'
fi
#echo ".pongorc content:   ${PONGORC_ARGS[@]}"


# Enterprise versions
if [[ ! -f $LOCAL_PATH/assets/kong_EE_versions.ver ]]; then
  err "$LOCAL_PATH/assets/kong_EE_versions.ver file is missing!"
fi
IFS=$'\r\n' GLOBIGNORE='*' command eval  'KONG_EE_VERSIONS=($(cat $LOCAL_PATH/assets/kong_EE_versions.ver))'
#echo "Current list:   ${KONG_EE_VERSIONS[@]}"


# Open source versions
if [[ ! -f $LOCAL_PATH/assets/kong_CE_versions.ver ]]; then
  err "$LOCAL_PATH/assets/kong_CE_versions.ver file is missing!"
fi
IFS=$'\r\n' GLOBIGNORE='*' command eval  'KONG_CE_VERSIONS=($(cat $LOCAL_PATH/assets/kong_CE_versions.ver))'
#echo "Current list:   ${KONG_CE_VERSIONS[@]}"


# Create a new array with all versions combined
KONG_VERSIONS=()
for VERSION in ${KONG_EE_VERSIONS[*]}; do
  KONG_VERSIONS+=("$VERSION")
done;
for VERSION in ${KONG_CE_VERSIONS[*]}; do
  KONG_VERSIONS+=("$VERSION")
done;

# take the last one as the default
KONG_DEFAULT_VERSION="${KONG_CE_VERSIONS[ ${#KONG_CE_VERSIONS[@]}-1 ]}"


function is_enterprise {
  local check_version=$1
  for VERSION in ${KONG_EE_VERSIONS[*]} $NIGHTLY_EE; do
    if [[ "$VERSION" == "$check_version" ]]; then
      return 0
    fi
  done;
  return 1
}

function is_nightly {
  local check_version=$1
  for VERSION in $NIGHTLY_CE $NIGHTLY_EE; do
    if [[ "$VERSION" == "$check_version" ]]; then
      return 0
    fi
  done;
  return 1
}

function version_exists {
  local version=$1
  for entry in ${KONG_VERSIONS[*]} $NIGHTLY_CE $NIGHTLY_EE ; do
    if [[ "$version" == "$entry" ]]; then
      return 0
    fi
  done;
  return 1
}

# resolve the KONG_VERSION in place
function resolve_version {
  if [[ "${KONG_VERSION: -1}" == "x" ]]; then
    local new_version=$KONG_VERSION
    for entry in ${KONG_VERSIONS[*]}; do
      if [[ "${KONG_VERSION:0:${#KONG_VERSION}-1}" == "${entry:0:${#entry}-1}" ]]; then
        # keep replacing, last one wins
        new_version=$entry
      fi
    done;
    if [[ "$new_version" == "$KONG_VERSION" ]]; then
      warn "Could not resolve Kong version: $KONG_VERSION"
    else
      msg "Resolved Kong version $KONG_VERSION to $new_version"
      KONG_VERSION=$new_version
    fi
  fi
}
