#!/usr/bin/env bash

# this test is not ran directly, but from these files;
#   pongo_run_ce.test.sh
#   pongo_run_ee.test.sh



# This function might need maintenance when new versions of Kong require
# backward incompatible changes to the "kong-plugin" template plugin.
# See https://github.com/Kong/kong-plugin
# For each version a specific commit/tag/branch can be specified below.
function checkout_commit {
  local VERSION=$1
  local COMMIT
  case $VERSION in
    # CE versions
    2.0.x|2.1.x|2.2.x)
      COMMIT="7b9929c19df0efc0643f8f8262ba8f7b0d0439d1"
      ;;

    # EE versions
    2.1.3.x|2.1.4.x|2.2.0.x|2.2.1.x)
      COMMIT="7b9929c19df0efc0643f8f8262ba8f7b0d0439d1"
      ;;


    *)
      COMMIT=master
      ;;
  esac

  git checkout $COMMIT
  if [ ! $? -eq 0 ]; then
    echo "failed to checkout version '$VERSION' with commit '$COMMIT'"
    exit 1
  fi
}


function versions_to_test {
  local PRODUCT=$1
  local COUNT=${2:-9999}
  local VERSIONS
  VERSIONS=$(pongo status versions | grep "$PRODUCT: " | sed "s/$PRODUCT: //")

  local VERSION
  local CLEAN_VERSIONS=()
  for VERSION in $VERSIONS ; do

    # step 1) add wilcard to get unique versions by major-minor (ignoring patch)
    if [[ "$VERSION" =~ ^[0-9] ]]; then
      # numeric version, so not a DEV one; replace last digits with 'x' wildcard
      local segments
      segments=$(( $(echo "$VERSION" | tr -cd '.' | wc -c) + 1 ))
      if ((segments == 4)); then
        # this is a 4 segment version, which means it is an EE version.
        # For an EE version we need to replace the last 2 digits
        VERSION="${VERSION:0:${#VERSION}-3}x.x"
      else
        # this should then be an OSS version, replace 1 digit
        VERSION="${VERSION:0:${#VERSION}-1}x"
      fi
    fi

    # step 2) store version if not already in our CLEAN_VERSIONS array
    local entry
    for entry in ${CLEAN_VERSIONS[*]}; do
      if [[ "$entry" == "$VERSION" ]]; then
        # already have this one
        VERSION=""
      fi
    done
    if [[ "$VERSION" != "" ]]; then
      CLEAN_VERSIONS+=("$VERSION")
    fi
  done

  # done; now list (in reverse) COUNT versions
  local c=${#CLEAN_VERSIONS[@]}
  while [[ $COUNT -ge 1 ]] && [[ $c -ge 1 ]]; do
    # your-unix-command-here
    echo "${CLEAN_VERSIONS[$c - 1]}"
    (( c = c - 1 ))
    (( COUNT = COUNT - 1))
  done
}


function test_single_version {
  local VERSION=$1

  ttest "pongo up"
  checkout_commit "$VERSION"
  KONG_VERSION=$VERSION pongo up
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  ttest "pongo build"
  KONG_VERSION=$VERSION pongo build
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  ttest "pongo run"
  KONG_VERSION=$VERSION pongo run
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  # cleanup working directory
  if [ -d ./servroot ]; then
    #rm -rf servroot                   doesn't work; priviledge issue
    KONG_VERSION=$VERSION pongo shell rm -rf /kong-plugin/servroot
  fi

  ttest "pongo down"
  KONG_VERSION=$VERSION pongo down
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi
}


function run_version_test {
  # run version based tests
  # 'product' determines CE or EE
  # 'count' determines how many to run (default is 9999)
  # versions do not include 'nightlies' eg.
  #   run_version_test "Kong Enterprise" 5  --> runs 5 latest Enterprise releases
  local PRODUCT=$1
  local COUNT=${2:-9999}
  if [ "$PRODUCT" != "Kong" ] && [ "$PRODUCT" != "Kong Enterprise" ]; then
    echo "function must be called with either 'Kong' or 'Kong Enterprise', got :$PRODUCT"
    exit 1
  fi

  tinitialize "Pongo test suite" "${BASH_SOURCE[0]}"

  local VERSIONS
  VERSIONS=$(versions_to_test "$PRODUCT" "$COUNT")

  # clone and enter test plugin directory
  git clone https://github.com/kong/kong-plugin.git
  pushd kong-plugin || exit 1

  for VERSION in $VERSIONS ; do
    tchapter "$PRODUCT $VERSION"
    test_single_version "$VERSION"
  done

  # cleanup
  popd || exit 1
  if [ -d ./kong-plugin ]; then
    rm -rf kong-plugin
  fi

  tfinish
}
