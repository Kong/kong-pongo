#!/usr/bin/env bash

function run_test {
  pushd assets/ci
  tinitialize "Pongo test suite" "${BASH_SOURCE[0]}"

  # 1 passing a command
  tchapter "run with coverage"

  ttest "running test with '--coverage' returns luacov output"

  # clone and enter test plugin directory
  git clone https://github.com/kong/kong-plugin.git
  pushd kong-plugin || exit 1

  [ -f ./luacov.stats.out ] && rm ./luacov.stats.out
  [ -f ./luacov.report.out ] && rm ./luacov.report.out

  pongo run --no-cassandra -- --coverage ./spec/myplugin/01-unit_spec.lua
  if [ ! -f ./luacov.stats.out ]; then
    tfailure "expected file ./luacov.stats.out not found"
  else
    if [ ! -f ./luacov.report.out ]; then
      tfailure "expected file ./luacov.report.out not found"
    else
      tsuccess "both LuaCov output files present"
    fi
  fi

  # cleanup
  popd || exit 1
  if [ -d ./kong-plugin ]; then
    rm -rf kong-plugin
  fi

  tfinish
  popd
}

# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && if [[ -f "${1:-$(dirname "$(realpath "$0")")/test.sh}" ]]; then source "${1:-$(dirname "$(realpath "$0")")/test.sh}"; else source "${1:-$(dirname "$(realpath "$0")")/run.sh}"; fi && set +e
run_test
