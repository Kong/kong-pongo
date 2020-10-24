#!/usr/bin/env bash


function run_test {
  pushd assets/ci
  # shellcheck disable=SC1091  # do not follow source
  source pongo_run.helper.sh

  # testing Kong Enterprise, with the 99 latest releases (not taking patch releases into account)
  run_version_test "Kong Enterprise" 99
  popd
}

# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && if [[ -f "${1:-$(dirname "$(realpath "$0")")/test.sh}" ]]; then source "${1:-$(dirname "$(realpath "$0")")/test.sh}"; else source "${1:-$(dirname "$(realpath "$0")")/run.sh}"; fi && set +e
run_test
