#!/usr/bin/env bash

function run_test {
  pushd assets/ci
  tinitialize "Pongo test suite" "${BASH_SOURCE[0]}"

  # 1 passing a command
  tchapter "Pongo in docker"

  # the assets/docker/Dockerfile will clone the Pongo repo to build the Pongo
  # container. To make sure it uses the same code as this test when running,
  # we must set PONGO_VERSION to the commitid we're testing, such that the Pongo
  # version in that image ends up being the same one as the one carrying this test
  # file.
  # Also: when running the tests locally, make sure the last commit is also in
  # Pongo repo, otherwise the build will not find that commit.
  export PONGO_VERSION
  PONGO_VERSION=$(git rev-parse HEAD)

  ttest "build.sh builds a Pongo image"
  ../docker/build.sh
  if [ $? -eq 1 ]; then
    tfailure
  else
    tsuccess
  fi

  tmessage "setup: clone test plugin and enter directory"
  git clone https://github.com/kong/kong-plugin.git
  pushd kong-plugin || exit 1


  ttest "pongo-docker up"
  ../../docker/pongo-docker.sh up
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi


  ttest "count unique Pongo environments"
  local pongo_env_count
  pongo_env_count=$(docker network ls | grep -c "pongo-")
  docker network ls
  if [ "$pongo_env_count" -eq 1 ]; then
    tsuccess "found $pongo_env_count Pongo networks"
  else
    tfailure "found $pongo_env_count Pongo networks, expected 1"
  fi


  ttest "pongo-docker build"
  ../../docker/pongo-docker.sh build
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi


  ttest "count unique Pongo environments"
  local pongo_env_count
  pongo_env_count=$(docker network ls | grep -c "pongo-")
  docker network ls
  if [ "$pongo_env_count" -eq 1 ]; then
    tsuccess "found $pongo_env_count Pongo networks"
  else
    tfailure "found $pongo_env_count Pongo networks, expected 1"
  fi


  ttest "pongo-docker run"
  ../../docker/pongo-docker.sh run
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi


  ttest "count unique Pongo environments"
  local pongo_env_count
  pongo_env_count=$(docker network ls | grep -c "pongo-")
  docker network ls
  if [ "$pongo_env_count" -eq 1 ]; then
    tsuccess "found $pongo_env_count Pongo networks"
  else
    tfailure "found $pongo_env_count Pongo networks, expected 1"
  fi


  # cleanup working directory
  tmessage "cleanup; clear working directory (servroot)"
  if [ -d ./servroot ]; then
    #rm -rf servroot                   doesn't work; priviledge issue
    ../../docker/pongo-docker.sh shell rm -rf /kong-plugin/servroot
  fi


  ttest "count unique Pongo environments"
  local pongo_env_count
  pongo_env_count=$(docker network ls | grep -c "pongo-")
  docker network ls
  if [ "$pongo_env_count" -eq 1 ]; then
    tsuccess "found $pongo_env_count Pongo networks"
  else
    tfailure "found $pongo_env_count Pongo networks, expected 1"
  fi


  ttest "pongo-docker down"
  ../../docker/pongo-docker.sh down
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi


  ttest "count unique Pongo environments"
  local pongo_env_count
  pongo_env_count=$(docker network ls | grep -c "pongo-")
  docker network ls
  if [ "$pongo_env_count" -eq 0 ]; then
    tsuccess "found $pongo_env_count Pongo networks"
  else
    tfailure "found $pongo_env_count Pongo networks, expected 0"
  fi


  # cleanup, delete cloned repo
  popd
  unset PONGO_VERSION
  tmessage "cleanup; removing test-plugin"
  rm -rf kong-plugin

  tfinish
}

# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && if [[ -f "${1:-$(dirname "$(realpath "$0")")/test.sh}" ]]; then source "${1:-$(dirname "$(realpath "$0")")/test.sh}"; else source "${1:-$(dirname "$(realpath "$0")")/run.sh}"; fi && set +e
run_test
