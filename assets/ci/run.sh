#!/usr/bin/env bash

# If you always want to run the latest version of the `test.sh` script, then use
# this `run.sh` script with an identical command line.
# So instead of copying `test.sh` into your project, copy `run.sh`.

# source repo: https://github.com/Tieske/test.sh



if [[ $0 == "${BASH_SOURCE[0]}" ]]; then
  # this script is executed, so test.sh must be executed
  bash  "/dev/stdin" "$@" <<<"$( curl -sS https://raw.githubusercontent.com/Tieske/test.sh/master/test.sh )"
else
  # we're sourced, so have to source test.sh
  # shellcheck disable=SC1091  # do not follow source
  source  "/dev/stdin" "$@" <<<"$( curl -sS https://raw.githubusercontent.com/Tieske/test.sh/master/test.sh )"
fi
