#!/usr/bin/env bash


function globals {
  LOCAL_PATH=$(dirname "$(realpath "$0")")
  DOCKER_FILE=${LOCAL_PATH}/Dockerfile
  DOCKER_COMPOSE_FILE=${LOCAL_PATH}/docker-compose.yml

  # Now here let's start the dependencies
  NETWORK_NAME=kong-plugin-test-network
  IMAGE_BASE_NAME=kong-plugin-test
  KONG_TEST_PLUGIN_PATH=$(realpath .)

  unset ACTION
  # By default we do not set it. Meaning test both postgres and cassandra
  unset KONG_DATABASE
  EXTRA_ARGS=()
}


function usage {
cat << EOF

Usage: $(basename $0) action [options...]

Options:
  --cassandra           only use cassandra db
  --postgres            only use postgres db

Commands:
  up            start required database containers for testing

  run           run spec files, accepts spec files or folders as arguments

  shell         get a shell directly on a kong container

  down          remove all containers

EOF
}


function parse_args {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --postgres)
        KONG_DATABASE=postgres
        ;;
      --cassandra)
        KONG_DATABASE=cassandra
        ;;
      --help|-h)
        usage; exit 0
        ;;
      *)
        EXTRA_ARGS+=("$1")
        ;;
    esac
    shift
  done
}


function get_version {
  local cmd=(
    '/bin/sh' '-c'
    "/usr/local/openresty/luajit/bin/luajit -e \"io.stdout:write(io.popen([[kong version]]):read():match([[([%d%.%-]+)]]))\""
  )
  VERSION=$(docker run -it --rm -e KONG_LICENSE_DATA "$KONG_IMAGE" "${cmd[@]}")
  KONG_TEST_IMAGE=$IMAGE_BASE_NAME:$VERSION
}


function compose {
  export NETWORK_NAME
  export KONG_TEST_IMAGE
  export KONG_TEST_PLUGIN_PATH
  docker-compose -f "$DOCKER_COMPOSE_FILE" "$@"
}

function healthy {
  local iid=$1
  [[ -z $iid ]] && return 1
  docker inspect "$iid" | grep healthy &> /dev/null
  return $?
}

function cid {
  compose ps -q "$1" 2> /dev/null
}


function wait_for_db {
  local iid
  local db="$1"

  iid=$(cid "$db")

  if healthy "$iid"; then return; fi

  msg "Waiting for $db"

  while ! healthy "$iid"; do
    sleep 0.5
  done
}


function main {
  parse_args "$@"

  ACTION=${EXTRA_ARGS[0]}; unset 'EXTRA_ARGS[0]'

  case "$ACTION" in
  build)
    get_version
    docker build \
      -f "$DOCKER_FILE" \
      --build-arg KONG_BASE="$KONG_IMAGE" \
      --build-arg KONG_DEV_FILES="./kong-versions/$VERSION/kong" \
      --tag "$KONG_TEST_IMAGE" \
      "$LOCAL_PATH" || err "Error: failed to build test environment"
    ;;
  up)
    if [[ -z $KONG_DATABASE ]] || [[ $KONG_DATABASE == "postgres" ]]; then
      healthy "$(cid postgres)" || compose up -d postgres
      wait_for_db postgres
    fi

    if [[ -z $KONG_DATABASE ]] || [[ $KONG_DATABASE == "cassandra" ]]; then
      healthy "$(cid cassandra)" || compose up -d cassandra
      wait_for_db cassandra
    fi
    ;;
  run)
    get_version
    local busted_params="-v -o gtest"
    if [[ -n $1 ]]; then
      local files=()
      local c_path
      for file in "${EXTRA_ARGS[@]}"; do
        [[ ! -f $file ]] && [[ ! -d $file ]] && err "$file does not exist"
        # substitute absolute host path for absolute docker path
        c_path=$(realpath "$file" | sed "s/${KONG_TEST_PLUGIN_PATH////\\/}/\/kong-plugin/")
        files+=( "$c_path" )
      done
      busted_params="$busted_params ${files[*]}"
    fi
    compose run --rm \
      -e KONG_LICENSE_DATA \
      -e KONG_TEST_PLUGIN_PATH \
      kong \
      "/bin/sh" "-c" "bin/busted $busted_params"
    ;;
  down)
    compose down
    ;;
  shell)
    get_version
    compose run --rm kong sh
    ;;
  *)
    usage
    exit 1
    ;;
  esac
}


function err {
  >&2 echo "$@"
  exit 1
}

function msg {
  >&2 echo "$@"
}


globals
main "$@"
