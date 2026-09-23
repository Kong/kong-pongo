#!/usr/bin/env bash

# Checks that PONGO_INSECURE only switches TLS verification off when it is
# actually asked for.
#
# The Dockerfile used to test this with
#     [ -n "$PONGO_INSECURE" ] || [ "$PONGO_INSECURE" != "false" ]
# where the two branches between them cover every value, so verification was
# disabled on every single build. That is invisible in the finished image,
# because a later layer removes ~/.curlrc and restores git's sslVerify, so it
# needs to be tested against the script the build actually runs.
#
# Runs that script directly with a throwaway HOME rather than building an
# image, so it stays fast enough to be worth running.

function run_test {
  pushd assets/ci
  tinitialize "Pongo test suite" "${BASH_SOURCE[0]}"

  tchapter "PONGO_INSECURE"

  local script="../configure-ssl-verification.sh"

  # runs the script with a clean HOME. 3 args:
  # 1. description of the case
  # 2. value for PONGO_INSECURE, or the literal "unset"
  # 3. expected outcome; "insecure" or "secure"
  function check_insecure {
    local desc="$1"
    local value="$2"
    local expect="$3"

    ttest "$desc"

    local home
    home=$(mktemp -d)

    if [ "$value" == "unset" ]; then
      HOME="$home" env -u PONGO_INSECURE bash "$script" > /dev/null 2>&1
    else
      HOME="$home" PONGO_INSECURE="$value" bash "$script" > /dev/null 2>&1
    fi

    local got="secure"
    if [ -f "$home/.curlrc" ] && grep -q -- "--insecure" "$home/.curlrc"; then
      got="insecure"
    fi
    if [ "$(HOME="$home" git config --global --get http.sslVerify)" == "false" ]; then
      got="insecure"
    fi

    rm -rf "$home"

    if [ "$got" == "$expect" ]; then
      tsuccess
    else
      tfailure "expected '$expect' but curl/git were left '$got'"
    fi
  }

  # the cases that regressed: verification must stay ON for these
  check_insecure "unset leaves verification on"        "unset"  "secure"
  check_insecure "empty leaves verification on"        ""       "secure"
  check_insecure "'false' leaves verification on"      "false"  "secure"

  # the opt-in still has to work
  check_insecure "'true' switches verification off"    "true"   "insecure"
  check_insecure "any other value switches it off"     "yes"    "insecure"

  tfinish
  popd
}

# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && if [[ -f "${1:-$(dirname "$(realpath "$0")")/test.sh}" ]]; then source "${1:-$(dirname "$(realpath "$0")")/test.sh}"; else source "${1:-$(dirname "$(realpath "$0")")/run.sh}"; fi && set +e
run_test
