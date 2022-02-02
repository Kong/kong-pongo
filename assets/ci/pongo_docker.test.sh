#!/usr/bin/env bash

function run_test {
  pushd assets/ci
  tinitialize "Pongo test suite" "${BASH_SOURCE[0]}"

  # 1 passing a command
  tchapter "Pongo in docker"

  ttest "build.sh builds a Pongo image"
  ../docker/build.sh
  if [ $? -eq 1 ]; then
    tfailure
  else
    tsuccess
  fi


  # clone and enter test plugin directory
  git clone https://github.com/kong/kong-plugin.git
  pushd kong-plugin || exit 1


  ttest "pongo-docker up"
  ../../docker/pongo-docker.sh up
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  ttest "pongo-docker build"
  ../../docker/pongo-docker.sh build
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  ttest "pongo-docker run"
  ../../docker/pongo-docker.sh run
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  # cleanup working directory
  if [ -d ./servroot ]; then
    #rm -rf servroot                   doesn't work; priviledge issue
    ../../docker/pongo-docker.sh shell rm -rf /kong-plugin/servroot
  fi

  ttest "pongo-docker down"
  ../../docker/pongo-docker.sh down
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  # cleanup, delete cloned repo
  popd
  rm -rf kong-plugin

  tfinish
}

# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && if [[ -f "${1:-$(dirname "$(realpath "$0")")/test.sh}" ]]; then source "${1:-$(dirname "$(realpath "$0")")/test.sh}"; else source "${1:-$(dirname "$(realpath "$0")")/run.sh}"; fi && set +e
run_test
