#!/usr/bin/env bash

function run_test {
  tinitialize "Pongo test suite" "${BASH_SOURCE[0]}"

  # 1 building an image
  tchapter "build image"

  # this version should be the latest patch release of a series,
  # eg. 2.0.x == 2.0.5
  TEST_VERSION=2.0.5


  ttest "builds the specified image: TEST_VERSION"
  KONG_VERSION=$TEST_VERSION pongo build
  KONG_VERSION=$TEST_VERSION pongo shell kong version | grep $TEST_VERSION
  if [ $? -eq 1 ]; then
    tfailure
  else
    tsuccess
  fi


  ttest "patch release is resolved: ${TEST_VERSION%?}x"
  KONG_VERSION=${TEST_VERSION%?}x pongo build 2>&1 | grep "already exists"
  if [ $? -eq 1 ]; then
    tfailure
  else
    KONG_VERSION=${TEST_VERSION%?}x pongo shell kong version | grep "$TEST_VERSION"
    if [ $? -eq 1 ]; then
      tfailure
    else
      tsuccess
    fi
  fi


  ttest "bad version fails with error"
  KONG_VERSION="bad_idea_this_version" pongo build
  if [ $? -eq 0 ]; then
    tfailure
  else
    tsuccess
  fi

  tfinish
}

# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && source "${1:-$(dirname "$(realpath "$0")")/test.sh}" && set +e
run_test
