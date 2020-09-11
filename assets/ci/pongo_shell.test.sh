#!/usr/bin/env bash

function run_test {
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

  # 3 setting available runtime environment variable
  tchapter "shell runtime environment"

  ttest "KONG_DATABASE and KONG_TEST_DATABASE env are not available"
  cat <<EOF > test_script
[[ -z \$KONG_DATABASE ]] && echo empty || echo KONG_DATABASE=\$KONG_DATABASE
[[ -z \$KONG_TEST_DATABASE ]] && echo empty || echo KONG_TEST_DATABASE=\$KONG_TEST_DATABASE
EOF
  chmod +x test_script
  pongo shell @test_script | [[ $(grep -c empty) -eq 2 ]]
  if [ $? -eq 1 ]; then
    tfailure
  else
    tsuccess
  fi

  ttest "KONG_DATABASE and KONG_TEST_DATABASE env are available"
  chmod +x test_script
  KONG_DATABASE=postgres KONG_TEST_DATABASE=cassandra pongo shell @test_script | \
    [[ $(grep -Ec "KONG_DATABASE=postgres|KONG_TEST_DATABASE=cassandra") -eq 2 ]]
  if [ $? -eq 1 ]; then
    tfailure
  else
    tsuccess
  fi

  # cleanup
  rm test_script

  tfinish
}

# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && source "${1:-$(dirname "$(realpath "$0")")/test.sh}" && set +e
run_test
