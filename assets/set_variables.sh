#!/usr/bin/env bash

# this requires LOCAL_PATH to be set to the Pongo directory

# special case accepted version identifiers
STABLE_CE=stable
STABLE_EE=stable-ee
DEVELOPMENT_CE=dev
DEVELOPMENT_EE=dev-ee


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


function is_enterprise {
  local check_version=$1
  local VERSION
  for VERSION in ${KONG_EE_VERSIONS[*]} $DEVELOPMENT_EE $STABLE_EE; do
    if [[ "$VERSION" == "$check_version" ]]; then
      return 0
    fi
  done;
  return 1
}

# this is to detect "commit-based" versions; the development ones
function is_commit_based {
  local check_version=$1
  local VERSION
  for VERSION in $DEVELOPMENT_CE $DEVELOPMENT_EE; do
    if [[ "$VERSION" == "$check_version" ]]; then
      return 0
    fi
  done;
  return 1
}

function version_exists {
  local version=$1
  local entry
  # not testing for "stable" tags here, since the resolve stage changes them to actual versions
  for entry in ${KONG_VERSIONS[*]} $DEVELOPMENT_CE $DEVELOPMENT_EE; do
    if [[ "$version" == "$entry" ]]; then
      return 0
    fi
  done;
  return 1
}

# resolve the KONG_VERSION in place
function resolve_version {
  if [[ "$KONG_VERSION" == "" ]]; then
    # default; use the latest CE release, but without displaying "resolved message"
    KONG_VERSION="${KONG_CE_VERSIONS[ ${#KONG_CE_VERSIONS[@]}-1 ]}"

  elif [[ "$KONG_VERSION" == "$STABLE_EE" ]]; then
    # resolve the latest release EE version
    KONG_VERSION="${KONG_EE_VERSIONS[ ${#KONG_EE_VERSIONS[@]}-1 ]}"
    msg "Resolved Kong version '$STABLE_EE' to '$KONG_VERSION'"

  elif [[ "$KONG_VERSION" == "$STABLE_CE" ]]; then
    # resolve the latest release EE version
    KONG_VERSION="${KONG_CE_VERSIONS[ ${#KONG_CE_VERSIONS[@]}-1 ]}"
    msg "Resolved Kong version '$STABLE_CE' to '$KONG_VERSION'"

  elif [[ "${KONG_VERSION: -1}" == "x" ]]; then
    # resolve trailing "x" to proper version
    local new_version=$KONG_VERSION
    local entry

    local segments
    segments=$(( $(echo "$KONG_VERSION" | tr -cd '.' | wc -c) + 1 ))

    if ((segments == 4)); then
      # this is a 4 segment version, which means it is an EE version.
      # For an EE version we need to resolve the last 2 segments
      for entry in ${KONG_VERSIONS[*]}; do
        if [[ "${KONG_VERSION:0:${#KONG_VERSION}-3}" == "${entry:0:${#entry}-3}" ]]; then
          # keep replacing, last one wins
          new_version=$entry
        fi
      done;
    else
      # this should then be an OSS version
      for entry in ${KONG_VERSIONS[*]}; do
        if [[ "${KONG_VERSION:0:${#KONG_VERSION}-1}" == "${entry:0:${#entry}-1}" ]]; then
          # keep replacing, last one wins
          new_version=$entry
        fi
      done;
    fi
    if [[ "$new_version" == "$KONG_VERSION" ]]; then
      warn "Could not resolve Kong version: '$KONG_VERSION'"
    else
      msg "Resolved Kong version '$KONG_VERSION' to '$new_version'"
      KONG_VERSION=$new_version
    fi
  fi
}
