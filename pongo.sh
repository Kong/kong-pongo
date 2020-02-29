#!/usr/bin/env bash

# use the "--debug" flag to debug this script; setting the "set -x" option

function globals {
  LOCAL_PATH=$(dirname "$(realpath "$0")")
  DOCKER_FILE=${LOCAL_PATH}/assets/Dockerfile
  DOCKER_COMPOSE_FILE=${LOCAL_PATH}/assets/docker-compose.yml

  PROJECT_NAME=kong-pongo
  NETWORK_NAME=${PROJECT_NAME}_test-network
  IMAGE_BASE_NAME=${PROJECT_NAME}-test
  KONG_TEST_PLUGIN_PATH=$(realpath .)

  unset ACTION
  KONG_DEPS_AVAILABLE=( "postgres" "cassandra" "redis" "squid")
  KONG_DEPS_START=( "postgres" "cassandra" )
  RC_COMMANDS=( "run" "up" )
  EXTRA_ARGS=()

  source ${LOCAL_PATH}/assets/set_variables.sh
  # resolve a '.x' to a real version; eg. "1.3.0.x" in $KONG_VERSION
  resolve_version

  unset CUSTOM_PLUGINS
  unset PLUGINS
}

function check_tools {

  docker -v > /dev/null
  if [[ ! $? -eq 0 ]]; then
    err "'docker' command not found, please install Docker, and make it available in the path."
  fi

  docker-compose -v > /dev/null
  if [[ ! $? -eq 0 ]]; then
    err "'docker-compose' command not found, please install docker-compose, and make it available in the path."
  fi

  realpath --version > /dev/null
  if [[ ! $? -eq 0 ]]; then
    err "'realpath' command not found, please install it, and make it available in the path (on Mac use Brew to install the 'coreutils' package)."
  fi

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

Usage: $(basename $0) action [options...] [--] [action options...]

Options (can also be added to '.pongorc'):
  --no-cassandra     do not start cassandra db
  --no-postgres      do not start postgres db
  --redis            do start redis db (available at 'redis:6379')
  --squid            do start squid forward-proxy (see readme for info)

Project actions:
  lint          will run the LuaCheck linter
  
  pack          will pack all '*.rockspec' files into '*.rock' files for
                distribution (see LuaRocks package manager docs)

  run           run spec files, accepts Busted options and spec files/folders
                as arguments, see: '$(basename $0) run -- --help'

  shell         get a shell directly on a kong container

  tail          starts a tail on the specified file. Default file is
                ./servroot/logs/error.log, an alternate file can be specified

Environment actions:
  build         build the Kong test image

  clean / nuke  removes the dependency containers and deletes all test images

  down          remove all dependency containers

  status        show status of the Pongo network, images, and containers

  up            start required dependency containers for testing

Maintenance actions:
  update        update embedded artifacts for building test images


Environment variables:
  KONG_VERSION  the specific Kong version to use when building the test image
                (note that the patch-version can be 'x' to use latest)

  KONG_IMAGE    the base Kong Docker image to use when building the test image

  KONG_LICENSE_DATA
                set this variable with the Kong Enterprise license data

  POSTGRES      the version of the Postgres dependency to use (default 9.5)
  CASSANDRA     the version of the Cassandra dependency to use (default 3.9)
  REDIS         the version of the Redis dependency to use (default 5.0.4)
  SQUID         the version of the Squid dependency to use (default 3.5.27-2)

Example usage:
  $(basename $0) run
  KONG_VERSION=1.3.x $(basename $0) run -v -o gtest ./spec/02-access_spec.lua
  POSTGRES=9.4 KONG_IMAGE=kong-ee $(basename $0) run
  $(basename $0) down

EOF
}


#array_contains arr "a b"  && echo yes || echo no
function array_contains {
  local array="$1[@]"
  local seeking=$2
  local in=1
  for element in "${!array}"; do
    if [[ "$element" == "$seeking" ]]; then
      in=0
      break
    fi
  done
  return $in
}


function add_dependency {
  local to_add=$1
  array_contains KONG_DEPS_START "$to_add" && return || KONG_DEPS_START+=("$to_add")
}


function remove_dependency {
  local to_remove=$1
  local new_array=()
  for dependency in ${KONG_DEPS_START[*]}; do
    if [[ "$dependency" != "$to_remove" ]]; then
      new_array+=("$dependency")
    fi
  done;
  KONG_DEPS_START=("${new_array[@]}")
}


function handle_dep_arg {
  local arg=$1
  local is_dep=1
  for dependency in ${KONG_DEPS_AVAILABLE[*]}; do
    if [[ "--$dependency" == "$arg" ]]; then
      add_dependency "$dependency"
      is_dep=0
      break
    fi
    if [[ "--no-$dependency" == "$arg" ]]; then
      remove_dependency "$dependency"
      is_dep=0
      break
    fi
  done;
  #msg "after '$arg' deps: ${KONG_DEPS_START[@]} extra-args: ${EXTRA_ARGS[@]}"
  return $is_dep
}


function parse_args {
  # inject the RC file commands into the commandline args
  local PONGO_ARGS=()
  # first add the main Pongo command
  local PONGO_COMMAND=$1
  PONGO_ARGS+=("$PONGO_COMMAND")
  shift

  # only add RC file parameters if command allows it
  for rc_command in ${RC_COMMANDS[*]}; do
    if [[ "$rc_command" == "$PONGO_COMMAND" ]]; then
      # add all the Pongo RC args
      for rc_arg in ${PONGORC_ARGS[*]}; do
        PONGO_ARGS+=("$rc_arg")
      done;
    fi
  done;

  # add remaining arguments from the command line
  while [[ $# -gt 0 ]]; do
    PONGO_ARGS+=("$1")
    shift
  done

  # parse the arguments
  local args_done=0
  for pongo_arg in ${PONGO_ARGS[*]}; do
    if [[ args_done -eq 0 ]]; then
      case "$pongo_arg" in
        --)
          args_done=1
          ;;
        --help|-h)
          usage; exit 0
          ;;
        --debug)
          set -x
          ;;
        *)
          handle_dep_arg "$pongo_arg" || EXTRA_ARGS+=("$pongo_arg")
          ;;
      esac
    else
      EXTRA_ARGS+=("$pongo_arg")
    fi
  done
}


function validate_version {
  local version=$1
  if $(version_exists $version); then
    return
  fi
  err "Version '$version' is not supported, supported versions are:
  Kong: ${KONG_CE_VERSIONS[@]}
  Kong Enterprise: ${KONG_EE_VERSIONS[@]}

If the '$version' is valid but not listed, you can try to update Pongo first, and then retry."
}


function get_image {
  local image
  if $(is_enterprise $KONG_VERSION); then
    image=kong-docker-kong-enterprise-edition-docker.bintray.io/kong-enterprise-edition:$KONG_VERSION-alpine
  else
    image=kong:$KONG_VERSION-alpine
  fi

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
      KONG_VERSION=$KONG_DEFAULT_VERSION
    fi
    validate_version $KONG_VERSION
    get_image
  fi

  VERSION=$(docker run --rm -e KONG_LICENSE_DATA "$KONG_IMAGE" "${cmd[@]}")
  KONG_TEST_IMAGE=$IMAGE_BASE_NAME:$VERSION
}


function compose {
  export NETWORK_NAME
  export KONG_TEST_IMAGE
  export KONG_TEST_PLUGIN_PATH
  docker-compose -p ${PROJECT_NAME} -f "$DOCKER_COMPOSE_FILE" "$@"
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


function wait_for_dependency {
  local iid
  local dep="$1"

  iid=$(cid "$dep")

  if healthy "$iid"; then return; fi

  msg "Waiting for $dep"

  while ! healthy "$iid"; do
    sleep 0.5
  done
}


function compose_up {
  for dependency in ${KONG_DEPS_START[*]}; do
    healthy "$(cid $dependency)" || compose up -d $dependency
  done;
}


function ensure_available {
  compose ps | grep "Up (health" &> /dev/null
  if [[ ! $? -eq 0 ]]; then
    msg "Notice: auto-starting the test environment, use the 'down' action to stop it"
    compose_up
  fi

  for dependency in ${KONG_DEPS_START[*]}; do
    wait_for_dependency $dependency
  done;
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


function get_plugin_names {
  if [[ -d ./kong/plugins/ ]]; then
    for dir in $(find ./kong/plugins -maxdepth 1 -mindepth 1 -type d); do
      dir=${dir##*/}    # grab everything after the final "/"
      if [[ -f ./kong/plugins/$dir/handler.lua ]]; then
        if [[ "$CUSTOM_PLUGINS" == "" ]]; then
          CUSTOM_PLUGINS=$dir
        else
          CUSTOM_PLUGINS=$CUSTOM_PLUGINS,$dir
        fi
      fi
    done
  fi
  if [[ "$CUSTOM_PLUGINS" == "" ]]; then
    PLUGINS=bundled
  else
    PLUGINS=bundled,$CUSTOM_PLUGINS
  fi
}


function cleanup {
  compose down
  docker images --filter=reference="${IMAGE_BASE_NAME}:*" --format "found: {{.ID}}" | grep found
  if [[ $? -eq 0 ]]; then
    docker rmi $(docker images --filter=reference="${IMAGE_BASE_NAME}:*" --format "{{.ID}}")
  fi
  if [ -d "$LOCAL_PATH/kong" ]; then
    rm -rf "$LOCAL_PATH/kong"
  fi
  if [ -d "$LOCAL_PATH/kong-ee" ]; then
    rm -rf "$LOCAL_PATH/kong-ee"
  fi
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

  tail)
    local tail_file="${EXTRA_ARGS[1]}"
    if [[ "$tail_file" == "" ]]; then
      tail_file="./servroot/logs/error.log"
    fi

    if [[ ! -f $tail_file ]]; then
      echo "waiting for tail file to appear: $tail_file"
      local index=1
      while [ $index -le 300 ]
      do
        if [[ -f $tail_file ]]; then
          break
        fi
        let index++
        sleep 1
      done
    fi

    tail -F "$tail_file"
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
    local files_start_index=1
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
      "/bin/sh" "-c" "bin/busted --helper=bin/busted_helper.lua ${busted_params[*]} ${busted_files[*]}"
    ;;

  down)
    compose down
    ;;

  shell)
    get_plugin_names
    get_version
    docker inspect --type=image $KONG_TEST_IMAGE &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "Notice: image '$KONG_TEST_IMAGE' not found, auto-building it"
      build_image
    fi
    compose run --rm \
      -e KONG_LICENSE_DATA \
      -e KONG_LOG_LEVEL \
      -e KONG_ANONYMOUS_REPORTS \
      -e "KONG_PG_DATABASE=kong_tests" \
      -e "KONG_PLUGINS=$PLUGINS" \
      -e "KONG_CUSTOM_PLUGINS=$CUSTOM_PLUGINS" \
      kong sh
    ;;

  lint)
    get_plugin_names
    get_version
    docker inspect --type=image $KONG_TEST_IMAGE &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "Notice: image '$KONG_TEST_IMAGE' not found, auto-building it"
      build_image
    fi
    compose run --rm \
      --workdir="/kong-plugin" \
      -e KONG_LICENSE_DATA \
      -e KONG_LOG_LEVEL \
      -e KONG_ANONYMOUS_REPORTS \
      -e "KONG_PG_DATABASE=kong_tests" \
      -e "KONG_PLUGINS=$PLUGINS" \
      -e "KONG_CUSTOM_PLUGINS=$CUSTOM_PLUGINS" \
      kong luacheck .
    ;;

  pack)
    get_plugin_names
    get_version
    docker inspect --type=image $KONG_TEST_IMAGE &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "Notice: image '$KONG_TEST_IMAGE' not found, auto-building it"
      build_image
    fi
    compose run --rm \
      --workdir="/kong-plugin" \
      -e KONG_LICENSE_DATA \
      -e KONG_LOG_LEVEL \
      -e KONG_ANONYMOUS_REPORTS \
      -e "KONG_PG_DATABASE=kong_tests" \
      -e "KONG_PLUGINS=$PLUGINS" \
      -e "KONG_CUSTOM_PLUGINS=$CUSTOM_PLUGINS" \
      kong pongo_pack
    ;;

  update)
    source ${LOCAL_PATH}/assets/update_versions.sh
    exit $?
    ;;

  status)
    echo Pongo networks:
    echo ===============
    docker network ls | grep "${PROJECT_NAME}"
    echo
    echo Pongo dependency containers:
    echo ============================
    docker ps | grep "${PROJECT_NAME}"
    echo
    echo Pongo cached images:
    echo ====================
    docker images "${PROJECT_NAME}*"
    echo
    ;;

  clean)
    cleanup
    ;;

  nuke)
    cleanup
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


check_tools
globals
main "$@"
