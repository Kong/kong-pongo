#!/bin/bash

# this requires LOCAL_PATH to be set to the Pongo directory

# special case accepted version identifiers
NIGHTLY_CE=nightly
NIGHTLY_EE=nightly-ee

VERSION_INFO=


function ml_message {
  # prefix each line of a multi-line input
  local prefix="$1"
  shift
  while IFS= read -r line; do >&2 echo -e "$prefix$line\033[0m"; done <<< "$@"
}


function err {
  ml_message "\033[0;31m[pongo-ERROR] " "$*"
  exit 1
}


function warn {
  ml_message "\033[0;33m[pongo-WARN] " "$*"
}


function msg {
  ml_message "\033[0;36m[pongo-INFO] " "$*"
}


# read config from Pongo RC file
if [[ -f $PONGORC_FILE ]]; then
  # shellcheck disable=SC2016  # expansion in single quotes: a false positive
  IFS=$'\r\n' GLOBIGNORE='*' command eval  'PONGORC_ARGS=($(cat $PONGORC_FILE))'
fi
#echo ".pongorc content:   ${PONGORC_ARGS[@]}"


# Enterprise versions
if [[ ! -f $LOCAL_PATH/assets/kong_EE_versions.ver ]]; then
  err "$LOCAL_PATH/assets/kong_EE_versions.ver file is missing!"
fi
# shellcheck disable=SC2016  # expansion in single quotes: a false positive
IFS=$'\r\n' GLOBIGNORE='*' command eval  'KONG_EE_VERSIONS=($(cat $LOCAL_PATH/assets/kong_EE_versions.ver))'
#echo "Current list:   ${KONG_EE_VERSIONS[@]}"


# Open source versions
if [[ ! -f $LOCAL_PATH/assets/kong_CE_versions.ver ]]; then
  err "$LOCAL_PATH/assets/kong_CE_versions.ver file is missing!"
fi
# shellcheck disable=SC2016  # expansion in single quotes: a false positive
IFS=$'\r\n' GLOBIGNORE='*' command eval  'KONG_CE_VERSIONS=($(cat $LOCAL_PATH/assets/kong_CE_versions.ver))'
#echo "Current list:   ${KONG_CE_VERSIONS[@]}"


# Create a new array with all versions combined (wrap in function for local vars)
KONG_VERSIONS=()
function create_all_versions_array {
  local VERSION
  for VERSION in ${KONG_EE_VERSIONS[*]}; do
    KONG_VERSIONS+=("$VERSION")
  done;
  for VERSION in ${KONG_CE_VERSIONS[*]}; do
    KONG_VERSIONS+=("$VERSION")
  done;
}
create_all_versions_array

# take the last one as the default
# shellcheck disable=SC2034  # Unused variable: this script is 'sourced', so a false positive
KONG_DEFAULT_VERSION="${KONG_CE_VERSIONS[ ${#KONG_CE_VERSIONS[@]}-1 ]}"


function is_enterprise {
  resolve_version_info "$1"
  if [[ "${VERSION_INFO[-1]}" == "ee" ]]; then
    return 0
  fi
  return 1
}

function is_nightly {
  resolve_version_info "$1"
  if [[ "${VERSION_INFO[0]}" =~ ^nightly.* ]]; then
    return 0
  fi
  return 1
}

function version_exists {
  resolve_version_info "$1"
  local version=${VERSION_INFO[0]}
  local entry
  local available_versions
  if is_enterprise "$1"; then
    available_versions="${KONG_EE_VERSIONS[*]} $NIGHTLY_EE"
  else
    available_versions="${KONG_CE_VERSIONS[*]} $NIGHTLY_CE"
  fi
  for entry in $available_versions ; do
    if [[ "$version" == "$entry" ]]; then
      return 0
    fi
  done;
  return 1
}

function resolve_version_info {
  IFS='-' read -r -a version_array <<< "$1"
  if [[ ${#version_array[*]} -ge 2 ]]; then
    if [[ "${version_array[0]}" == "nightly" ]]; then
      VERSION_INFO=("$1" "${version_array[-1]}")
      return
    fi
    if [[ "${version_array[-1]}" == "ee" ]]; then
      local version
      for v in ${version_array[*]:0:${#version_array[*]}-1}; do
        if [[ -z "$version" ]]; then
          version="$v"
        else
          version="${version}-$v"
        fi
      done
      VERSION_INFO=("$version" "${version_array[-1]}")
      return
    fi
  fi
  VERSION_INFO=("$1" "ce")
}

function is_legacy_ee_version {
  local res="${1//[^\.]}"
  if [[ ${#res} -eq 3 ]]; then
    return 0
  fi
  return 1
}

# resolve the KONG_VERSION in place
function resolve_version {
  if [[ "${KONG_VERSION: -1}" == "x" ]]; then
    local new_version=$KONG_VERSION
    local entry
    local is_enterprise=false

    for entry in ${KONG_EE_VERSIONS[*]}; do
      if [[ "${KONG_VERSION:0:${#KONG_VERSION}-1}" == "${entry:0:${#entry}-1}" ]]; then
        # keep replacing, last one wins
        new_version=$entry
        is_enterprise=true
      fi
    done;

    if [[ "$PONGO_ENTERPRISE" != "true" ]]; then
      for entry in ${KONG_CE_VERSIONS[*]}; do
        if [[ "${KONG_VERSION:0:${#KONG_VERSION}-1}" == "${entry:0:${#entry}-1}" ]]; then
          # keep replacing, last one wins
          new_version=$entry
          is_enterprise=false
        fi
      done;
    fi

    if [[ "$new_version" == "$KONG_VERSION" ]]; then
      warn "Could not resolve Kong version: $KONG_VERSION"
    else
      if [[ "$is_enterprise" == "true" ]]; then
        msg "Resolved Kong version $KONG_VERSION to Kong Enterprise $new_version"
        # set the flag manually here, for these special EE versions: 0.33-2, 0.34 etc.
        PONGO_ENTERPRISE=true
      else
        msg "Resolved Kong version $KONG_VERSION to $new_version"
      fi
      KONG_VERSION="${new_version}"
    fi
  fi
}
