#!/usr/bin/env bash

function run_test {
  pushd assets/ci
  tinitialize "Pongo test suite" "${BASH_SOURCE[0]}"

  # 1 passing a command
  tchapter "shell command"

  ttest "succesful command has a 0 exitcode"
  pongo shell echo hello
  if [ $? -eq 1 ]; then
    tfailure
  else
    tsuccess
  fi


  ttest "command output is passed"
  pongo shell echo hello | grep "hello"
  if [ $? -eq 1 ]; then
    tfailure
  else
    tsuccess
  fi


  ttest "command errors are returned"
  pongo shell an_erroneous_command
  if [ $? -eq 0 ]; then
    tfailure
  else
    tsuccess
  fi


  ttest "command supresses printing the Kong version"
  pongo shell echo hello | grep "version"
  if [ $? -eq 0 ]; then
    tfailure
  else
    tsuccess
  fi



  # 2 passing a script
  tchapter "shell script"

  # create a script
  cat <<EOF > test_script
echo "world domination"
EOF
  chmod +x test_script


  ttest "succesful script has a 0 exitcode"
  pongo shell @test_script
  if [ $? -eq 1 ]; then
    tfailure
  else
    tsuccess
  fi


  ttest "script output is passed"
  pongo shell @test_script | grep "domination"
  if [ $? -eq 1 ]; then
    tfailure
  else
    tsuccess
  fi


  ttest "script supresses printing the Kong version"
  pongo shell @test_script | grep "version"
  if [ $? -eq 0 ]; then
    tfailure
  else
    tsuccess
  fi


  ttest "script errors are returned"
  cat <<EOF > test_script
exit 1
EOF
  chmod +x test_script
  pongo shell @test_script
  if [ $? -eq 0 ]; then
    tfailure
  else
    tsuccess
  fi

  # cleanup
  rm test_script

  tfinish
  popd
}

# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && if [[ -f "${1:-$(dirname "$(realpath "$0")")/test.sh}" ]]; then source "${1:-$(dirname "$(realpath "$0")")/test.sh}"; else source "${1:-$(dirname "$(realpath "$0")")/run.sh}"; fi && set +e
run_test
