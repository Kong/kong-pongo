#!/usr/bin/env bash

# If you always want to run the latest version of the `test.sh` script, then use
# this `run.sh` script with an identical command line.
# So instead of copying `test.sh` into your project, copy `run.sh`.

# source: https://github.com/Tieske/run.sh

curl https://raw.githubusercontent.com/Tieske/test.sh/master/test.sh | bash /dev/stdin "$@"
