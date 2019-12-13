#!/bin/bash

# Enterprise versions
KONG_EE_VERSIONS=(
  "0.33" "0.33-1" "0.33-2"
  "0.34" "0.34-1"
  "0.35" "0.35-1" "0.35-3" "0.35-4"
  "0.36-1" "0.36-2" "0.36-3" "0.36-4"
  # 0.36 is not supported because LuaRocks was borked in that version
  "1.3"
)

# Open source versions
KONG_CE_VERSIONS=(
  "0.13.0" "0.13.1"
  "0.14.0" "0.14.1"
  "0.15.0"
  "1.0.0" "1.0.1" "1.0.2" "1.0.3" "1.0.4"
  "1.1.0" "1.1.1" "1.1.2" "1.1.3"
  "1.2.0" "1.2.1" "1.2.2"
  "1.3.0"
  "1.4.0" "1.4.1" "1.4.2"
)


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
  for VERSION in ${KONG_EE_VERSIONS[*]}; do
    if [[ "$VERSION" == "$check_version" ]]; then
      return 0
    fi
  done;
  return 1
}
