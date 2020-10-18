#!/usr/bin/env bash

function run_test {
  pushd assets/ci
  tinitialize "Pongo test suite" "${BASH_SOURCE[0]}"

  tchapter "expose ports to host"

  # start Pongo environment
  pongo up --no-cassandra --postgres --expose
  pongo build
  sleep 5

  # create a script to start kong (sleep long becasue we do not want the
  # container to exit, pongo down will kill it later)
  cat <<EOF > test_script
kong migrations bootstrap --force
kong start && sleep 86400
EOF
  chmod +x test_script

  # run in background
  pongo shell @test_script &
  sleep 20


  ttest "exposes Kong proxy port"

  curl http://localhost:8000/
  if [ $? -eq 0 ]; then
    echo
    tsuccess
  else
    echo
    tmessage "couldn't connect to proxy port"
    tfailure
  fi


  ttest "exposes Kong proxy ssl port"

  curl -k https://localhost:8443/
  if [ $? -eq 0 ]; then
    echo
    tsuccess
  else
    echo
    tmessage "couldn't connect to proxy port"
    tfailure
  fi


  ttest "exposes Kong admin port"

  curl http://localhost:8001/
  if [ $? -eq 0 ]; then
    echo
    tsuccess
  else
    echo
    tmessage "couldn't connect to admin port"
    tfailure
  fi


  ttest "exposes Kong admin ssl port"

  curl -k https://localhost:8444/
  if [ $? -eq 0 ]; then
    echo
    tsuccess
  else
    echo
    tmessage "couldn't connect to admin port"
    tfailure
  fi


  # cleanup
  pongo down
  rm test_script

  tfinish
  popd
}


# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && if [[ -f "${1:-$(dirname "$(realpath "$0")")/test.sh}" ]]; then source "${1:-$(dirname "$(realpath "$0")")/test.sh}"; else source "${1:-$(dirname "$(realpath "$0")")/run.sh}"; fi && set +e
run_test
