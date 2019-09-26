#!/usr/bin/env bash

function globals {
  LOCAL_PATH=$(dirname "$(realpath "$0")")
  DOCKER_FILE=${LOCAL_PATH}/Dockerfile
  DOCKER_COMPOSE_FILE=${LOCAL_PATH}/docker-compose.yml

  NETWORK_NAME=kong-pongo-test-network
  IMAGE_BASE_NAME=kong-pongo-test
  KONG_TEST_PLUGIN_PATH=$(realpath .)

  unset ACTION
  # By default we do not set it. Meaning test both postgres and cassandra
  unset KONG_DATABASE
  EXTRA_ARGS=()

  source ${LOCAL_PATH}/set_variables.sh
}


function usage {
cat << EOF

                /~\\
  ______       C oo
  | ___ \      _( ^)
  | |_/ /__  _/__ ~\ __   ___
  |  __/ _ \| '_ \ / _\` |/ _ \\
  | | | (_) | | | | (_| | (_) |
  \_|  \___/|_| |_|\__, |\___/
                    __/ |
                   |___/

Usage: $(basename $0) action [options...]

Options:
  --cassandra           only use cassandra db
  --postgres            only use postgres db

Actions:
  up            start required database containers for testing

  build         build the Kong test image

  run           run spec files, accepts Busted options and spec files/folders
                as arguments, see: '$(basename $0) run -- --help' 

  shell         get a shell directly on a kong container

  down          remove all containers

Environment variables:
  KONG_VERSION  the specific Kong version to use when building the test image

  KONG_IMAGE    the base Kong Docker image to use when building the test image

  KONG_LICENSE_DATA
                set this variable with the Kong Enterprise license data

Example usage:
  $(basename $0) run
  KONG_VERSION=0.36-1 $(basename $0) run -v -o gtest ./spec/02-access_spec.lua
  KONG_IMAGE=kong-ee $(basename $0) run
  $(basename $0) down

EOF
}


function parse_args {
  local args_done=0
  while [[ $# -gt 0 ]]; do
    if [[ args_done -eq 0 ]]; then
      case "$1" in
        --)
          args_done=1
          ;;
        --postgres)
          KONG_DATABASE=postgres
          ;;
        --cassandra)
          KONG_DATABASE=cassandra
          ;;
        --help|-h)
          usage; exit 0
          ;;
        --debug)
          set -x
          ;;
        *)
          EXTRA_ARGS+=("$1")
          ;;
      esac
    else
      EXTRA_ARGS+=("$1")
    fi
    shift
  done
}


function validate_version {
  local version=$1
  for entry in $KONG_EE_VERSIONS ; do
    if [[ "$version" == "$entry" ]]; then
      return
    fi
  done;
  err "version '$version' is not supported, supported versions are: "$'\n'"  $KONG_EE_VERSIONS"
}


function get_image {
  local image=kong-docker-kong-enterprise-edition-docker.bintray.io/kong-enterprise-edition:$KONG_VERSION-alpine
  docker inspect --type=image $image &> /dev/null
  if [[ ! $? -eq 0 ]]; then
    docker pull $image
    if [[ ! $? -eq 0 ]]; then
      err "failed to pull: $image"
    fi
  fi

  KONG_IMAGE=$image
}


function get_version {
  local cmd=(
    '/bin/sh' '-c'
    "/usr/local/openresty/luajit/bin/luajit -e \"io.stdout:write(io.popen([[kong version]]):read():match([[([%d%.%-]+)]]))\""
  )
  if [[ -z $KONG_IMAGE ]]; then
    if [[ -z $KONG_VERSION ]]; then
      KONG_VERSION=$KONG_EE_DEFAULT_VERSION
    fi
    validate_version $KONG_VERSION
    get_image
  fi

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


function compose_up {
  if [[ -z $KONG_DATABASE ]] || [[ $KONG_DATABASE == "postgres" ]]; then
    healthy "$(cid postgres)" || compose up -d postgres
  fi

  if [[ -z $KONG_DATABASE ]] || [[ $KONG_DATABASE == "cassandra" ]]; then
    healthy "$(cid cassandra)" || compose up -d cassandra
  fi
}


function ensure_available {
  compose ps | grep "Up (health" &> /dev/null
  if [[ ! $? -eq 0 ]]; then
    msg "Notice: auto-starting the test environment, use the 'down' action to stop it"
    compose_up
  fi

  if [[ -z $KONG_DATABASE ]] || [[ $KONG_DATABASE == "postgres" ]]; then
    wait_for_db postgres
  fi

  if [[ -z $KONG_DATABASE ]] || [[ $KONG_DATABASE == "cassandra" ]]; then
    wait_for_db cassandra
  fi
}

function build_image {
  get_version
  validate_version $VERSION
  docker build \
    -f "$DOCKER_FILE" \
    --build-arg KONG_BASE="$KONG_IMAGE" \
    --build-arg KONG_DEV_FILES="./kong-versions/$VERSION/kong" \
    --tag "$KONG_TEST_IMAGE" \
    "$LOCAL_PATH" || err "Error: failed to build test environment"
}

function main {
  parse_args "$@"

  ACTION=${EXTRA_ARGS[0]}; unset 'EXTRA_ARGS[0]'

  case "$ACTION" in

  build)
    build_image
    ;;

  up)
    compose_up
    ;;

  run)
    ensure_available
    get_version

    docker inspect --type=image $KONG_TEST_IMAGE &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "Notice: image '$KONG_TEST_IMAGE' not found, auto-building it"
      build_image
    fi

    # figure out where in the arguments list the file-list starts
    local files_start_index=9999
    local index=1
    for arg in "${EXTRA_ARGS[@]}"; do
      if [[ ! -f $arg ]] && [[ ! -d $arg ]]; then
        # arg does not exist as a file, so files start at the
        # next index at the earliest
        let files_start_index=$index+1
      fi
      let index++
    done

    local busted_params=()
    local busted_files=()
    index=1
    for arg in "${EXTRA_ARGS[@]}"; do
      if [[ "$index" -lt "$files_start_index" ]]; then
        busted_params+=( "$arg" )
      else
        # substitute absolute host path for absolute docker path
        local c_path=$(realpath "$arg" | sed "s/${KONG_TEST_PLUGIN_PATH////\\/}/\/kong-plugin/")
        busted_files+=( "$c_path" )
      fi
      let index++
    done

    if [[ ${#busted_files[@]} -eq 0 ]]; then
      # no paths given, so set up the busted default: ./spec
      busted_files+=( "/kong-plugin/spec" )
    fi

    compose run --rm \
      -e KONG_LICENSE_DATA \
      -e KONG_TEST_PLUGIN_PATH \
      kong \
      "/bin/sh" "-c" "bin/busted ${busted_params[*]} ${busted_files[*]}"
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
