#!/usr/bin/env bash


function run_test {
  # shellcheck disable=SC1090  # do not follow source
  source "$(dirname "$(realpath "$0")")/pongo_run.helper.sh"

  # testing Kong Enterprise, with the 99 latest releases (not taking patch releases into account)
  run_version_test "Kong Enterprise" 99
}

# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && source "${1:-$(dirname "$(realpath "$0")")/test.sh}" && set +e
run_test
