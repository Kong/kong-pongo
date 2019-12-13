#!/bin/bash

function read_ce_versions {
  KONG_CE_VERSIONS=()
  while IFS= read value; do
    KONG_CE_VERSIONS+=($value)
  done < "${LOCAL_PATH}/.kong-ce"

  for exclude in ${KONG_CE_VERSIONS_EXCLUDE[@]}; do
    KONG_CE_VERSIONS=( "${KONG_CE_VERSIONS[@]/$exclude}" )
  done
}

function update_repo {
  local repo_name=$1

  if [ ! -d "./$repo_name" ]; then
    git clone -q https://github.com/kong/$repo_name.git
    if [ ! $? -eq 0 ]; then
      echo "Error: cannot update git repo $repo_name, make sure you're authorized and connected!"
      exit 1
    fi
  fi

  pushd $repo_name > /dev/null

  git checkout -q master
  git pull -q

  if [[ "$repo_name" == "kong" ]]; then
    rm -f "${LOCAL_PATH}/.kong-ce"
    git tag --sort=v:refname | grep -o '^[0-9]*\.[0-9]*\.[0-9]*$' | uniq | tail -r | sed '/0.12.3/,$d' | tail -r > "${LOCAL_PATH}/.kong-ce"

    read_ce_versions
  fi

  if [ ! $? -eq 0 ]; then
    echo "Warning: cannot pull latest changes for $repo_name, make sure you're authorized and connected!"
  fi
  popd > /dev/null
}

# Enterprise versions
KONG_EE_VERSIONS=(
  "0.33" "0.33-1" "0.33-2"
  "0.34" "0.34-1"
  "0.35" "0.35-1" "0.35-3" "0.35-4"
  "0.36-1" "0.36-2"
  # 0.36 is not supported because LuaRocks was borked in that version
  "1.3"
)

# Open source versions
KONG_CE_VERSIONS=()
KONG_CE_VERSIONS_EXCLUDE=()

if [ -f "${LOCAL_PATH}/.kong-ce" ]; then
  read_ce_versions
else
  update_repo kong
fi

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
