#!/usr/bin/env bash

# use the "--debug" flag to debug this script; setting the "set -x" option

function globals {
  # Project related global variables
  PONGO_VERSION=2.19.0

  local script_path
  # explicitly resolve the link because realpath doesn't do it on Windows
  script_path=$(test -L "$0" && readlink "$0" || echo "$0")
  LOCAL_PATH=$(dirname "$(realpath "$script_path")")

  if [[ -f "$KONG_TEST_PLUGIN_PATH/.pongo/pongorc" ]]; then
    PONGORC_FILE=".pongo/pongorc"
  elif [[ -f "$KONG_TEST_PLUGIN_PATH/.pongorc" ]]; then
    # for backward compatibility
    PONGORC_FILE=".pongorc"
  else
    PONGORC_FILE=".pongo/pongorc"
  fi

  # shellcheck disable=SC1090  # do not follow source
  source "${LOCAL_PATH}/assets/set_variables.sh"

  DOCKER_FILE=${PONGO_DOCKER_FILE:-$LOCAL_PATH/assets/Dockerfile}
  DOCKER_COMPOSE_FILES="-f ${LOCAL_PATH}/assets/docker-compose.yml"
  IMAGE_BASE_PREFIX="kong-pongo-"
  IMAGE_BASE_NAME=$IMAGE_BASE_PREFIX$PONGO_VERSION

  DOCKER_BUILD_EXTRA_ARGS="${DOCKER_BUILD_EXTRA_ARGS:-}"

  # the path where the plugin source is located, as seen from Pongo (this script)
  KONG_TEST_PLUGIN_PATH=$(realpath .)

  # the working directory, which is the path where the plugin-source is located
  # on the host machine. Only if Pongo is running inside docker itself, the
  # PONGO_WD differs from the KONG_TEST_PLUGIN_PATH
  PONGO_WD=$KONG_TEST_PLUGIN_PATH
  if [[ -d "/pongo_wd" ]]; then
    local HOST_PATH
    PONGO_CONTAINER_ID=$(</pongo_wd/.containerid)
    if [[ "$PONGO_CONTAINER_ID" == "" ]]; then
      warn "'/pongo_wd' path is defined, but failed to get the container id from"
      warn "the '/pongo_wd/.containerid' file. Start the Pongo container with"
      warn "'--cidfile \"[plugin-path]/.containerid\"' to set the file."
      warn "If you are NOT running Pongo itself inside a container, then make"
      warn "sure '/pongo_wd' doesn't exist."
    else
      #msg "Pongo container: $PONGO_CONTAINER_ID"
      HOST_PATH=$(docker inspect "$PONGO_CONTAINER_ID" | grep ":/pongo_wd.*\"" | sed -e 's/^[ \t]*//' | sed s/\"//g | grep -o "^[^:]*")
      #msg "Host working directory: $HOST_PATH"
    fi
    if [[ "$HOST_PATH" == "" ]]; then
      warn "Failed to read the container information, could not retrieve the"
      warn "host path of the '/pongo_wd' directory."
      warn "Make sure to start the container running Pongo with:"
      warn "    -v /var/run/docker.sock:/var/run/docker.sock"
      warn "NOTE: make sure you understand the security implications!"
      err "Failed to get container info."
    fi
    if [[ ! $KONG_TEST_PLUGIN_PATH == /pongo_wd ]] && [[ ! ${KONG_TEST_PLUGIN_PATH:0:10} == /pongo_wd/ ]]; then
      err "When Pongo itself runs inside a container, the plugin source MUST be within the '/pongo_wd' path"
    fi
    PONGO_WD=${KONG_TEST_PLUGIN_PATH/\/pongo_wd/${HOST_PATH}}
  fi

  # create unique projectID based on file-path (on the host machine)
  PROJECT_ID=$(echo -n "$PONGO_WD" | $MD5_COMMAND )
  PROJECT_ID="${PROJECT_ID:0:8}"

  PROJECT_NAME_PREFIX="pongo-"
  PROJECT_NAME=${PROJECT_NAME_PREFIX}${PROJECT_ID}

  NETWORK_NAME=pongo-test-network
  SERVICE_NETWORK_PREFIX="pongo-"
  SERVICE_NETWORK_NAME=${SERVICE_NETWORK_PREFIX}${PROJECT_ID}

  unset WINDOWS_SLASH
  unset WINPTY_PREFIX
  unset PONGO_PLATFORM
  if [ "$(uname -s)" == "Darwin" ]; then
    # all Apple platforms
    export PONGO_PLATFORM="APPLE"
  elif uname -s | grep -q "MINGW"; then
    # Git Bash for Windows
    # Msys (not supported!)
    export PONGO_PLATFORM="WINDOWS"
    # Windows/MinGW requires an extra / in docker command so //bin/bash
    # https://www.reddit.com/r/docker/comments/734arg/cant_figure_out_how_to_bash_into_docker_container/
    WINDOWS_SLASH="/"
    if winpty --help > /dev/null; then
      # for terminal output we passthrough winpty
      WINPTY_PREFIX="winpty"
    fi
  elif grep -q WSL < /proc/version; then
    # WSL and WSL2
    export PONGO_PLATFORM="WINDOWS"
  else
    export PONGO_PLATFORM="LINUX"
  fi

  # when running CI do we have the required secrets available? (used for EE only)
  # secrets are unavailable for PR's from outside the organization (untrusted)
  # can be set to "true" or "false", defaults to the Travis-CI setting
  if [[ "$PONGO_SECRETS_AVAILABLE" == "" ]]; then
    PONGO_SECRETS_AVAILABLE="$TRAVIS_SECURE_ENV_VARS"
  fi

  # regular Kong Enterprise images repo (tag is build as $PREFIX$VERSION$POSTFIX).
  KONG_EE_TAG_PREFIX="kong/kong-gateway:"
  KONG_EE_TAG_POSTFIX="-ubuntu"

  # # all Kong Enterprise images repo (tag is build as $PREFIX$VERSION$POSTFIX).
  # # these are private, credentials are needed
  # KONG_EE_PRIVATE_TAG_PREFIX="kong/kong-gateway-private:"
  # KONG_EE_PRIVATE_TAG_POSTFIX="-ubuntu"

  # regular Kong CE images repo (tag is build as $PREFIX$VERSION$POSTFIX)
  KONG_OSS_TAG_PREFIX="kong:"
  KONG_OSS_TAG_POSTFIX="-ubuntu"

  # unoffical Kong CE images repo, the fallback
  KONG_OSS_UNOFFICIAL_TAG_PREFIX="kong/kong:"
  KONG_OSS_UNOFFICIAL_TAG_POSTFIX="-ubuntu"

  # development EE images repo, these are public, no credentials needed
  DEVELOPMENT_EE_TAG="kong/kong-gateway-dev:master-ubuntu"

  # development CE images, these are public, no credentials needed
  DEVELOPMENT_CE_TAG="kong/kong:master-ubuntu"


  # dependency health checks
  if [[ -z $HEALTH_TIMEOUT ]]; then
    export HEALTH_TIMEOUT=60
  fi
  if [[ $HEALTH_TIMEOUT -lt 0 ]]; then
    export HEALTH_TIMEOUT=0
  fi
  if [[ $HEALTH_TIMEOUT -eq 0 ]]; then
    export SERVICE_DISABLE_HEALTHCHECK=true
  fi

  # Dependency image defaults
  if [[ -z $POSTGRES_IMAGE ]] && [[ -n $POSTGRES ]]; then
    # backward compat; POSTGRES replaced by POSTGRES_IMAGE
    export POSTGRES_IMAGE=postgres:$POSTGRES
  fi

  if [[ -z $CASSANDRA_IMAGE ]] && [[ -n $CASSANDRA ]]; then
    # backward compat; CASSANDRA replaced by CASSANDRA_IMAGE
    export CASSANDRA_IMAGE=cassandra:$CASSANDRA
  fi

  if [[ -z $REDIS_IMAGE ]] && [[ -n $REDIS ]]; then
    # backward compat; replaced by REDIS_IMAGE
    export REDIS_IMAGE=redis:$REDIS-alpine
  fi

  if [[ -z $SQUID_IMAGE ]] && [[ -n $SQUID ]]; then
    # backward compat; replaced by SQUID_IMAGE
    export SQUID_IMAGE=sameersbn/squid:$SQUID
  fi

  # proxy config, ensure it's set in all lower-case
  # shellcheck disable=SC2153
  if [[ -z $http_proxy ]] && [[ -n $HTTP_PROXY ]]; then
    export http_proxy=$HTTP_PROXY
  fi
  # shellcheck disable=SC2153
  if [[ -z $https_proxy ]] && [[ -n $HTTPS_PROXY ]]; then
    export https_proxy=$HTTPS_PROXY
  fi
  # shellcheck disable=SC2153
  if [[ -z $ftp_proxy ]] && [[ -n $FTP_PROXY ]]; then
    export ftp_proxy=$FTP_PROXY
  fi
  # shellcheck disable=SC2153
  if [[ -z $no_proxy ]] && [[ -n $NO_PROXY ]]; then
    export no_proxy=$NO_PROXY
  fi

  # Commandline related variables
  unset ACTION
  FORCE_BUILD=${PONGO_FORCE_BUILD:-false}
  KONG_DEPS_AVAILABLE=( "postgres" "cassandra" "redis" "squid" "grpcbin" "expose")
  KONG_DEPS_START=( "postgres" )
  KONG_DEPS_CUSTOM=()
  RC_COMMANDS=( "run" "up" "restart" )
  EXTRA_ARGS=()

  # custom CA certificates file in PEM format
  # can be set using the '--custom-ca-cert' CLI option or
  PONGO_CUSTOM_CA_CERT=${PONGO_CUSTOM_CA_CERT:-}
  # true if loaded from CLI option
  PONGO_CUSTOM_CA_CERT_CLI=

  # resolve a '.x' to a real version; eg. "1.3.0.x" in $KONG_VERSION, and replace
  # "stable" and "stable-ee" with actual versions
  resolve_version

  unset CUSTOM_PLUGINS
  unset PLUGINS
}


function check_tools {
  local missing=false

  docker -v > /dev/null 2>&1
  if [[ ! $? -eq 0 ]]; then
    >&2 echo "'docker' command not found, please install Docker, and make it available in the path."
    missing=true
  fi

  docker compose > /dev/null 2>&1
  if [[ ! $? -eq 0 ]]; then
    docker-compose -v > /dev/null 2>&1
    if [[ ! $? -eq 0 ]]; then
      >&2 echo "'docker-compose' and 'docker compose' commands not found, please upgrade docker or install docker-compose and make it available in the path."
      missing=true
    fi
    # old deprecated way; using docker-compose as a separate command
    COMPOSE_COMMAND="docker-compose"
  else
    # newer version; compose is a subcommand of docker
    COMPOSE_COMMAND="docker compose"
  fi

  realpath . > /dev/null 2>&1
  if [[ ! $? -eq 0 ]]; then
    >&2 echo "'realpath' command not found, please install it, and make it available in the path (on Mac use Brew to install the 'coreutils' package)."
    missing=true
  fi

  curl -V > /dev/null 2>&1
  if [[ ! $? -eq 0 ]]; then
    >&2 echo "'curl' command not found, please install it, and make it available in the path."
    missing=true
  fi

  # Detect the MD5 command
  if command -v md5sum &> /dev/null; then
    # Unix
    MD5_COMMAND="md5sum"
  elif command -v gmd5sum &> /dev/null; then
    # GNU
    MD5_COMMAND="gmd5sum"
  elif command -v md5 &> /dev/null; then
    # BSD/Mac
    MD5_COMMAND="md5"
  else
    >&2 echo "'md5sum', 'gmd5sum', and 'md5' commands not found, please install anyone of them, and make it available in the path."
    missing=true
  fi

  if [[ "$missing" == "true" ]]; then
    >&2 echo -e "\033[0;31m[pongo-ERROR] the above dependencies are missing, install and retry.\033[0m"
    exit 1
  fi
}


function logo {
  PONGO_VERSION=$PONGO_VERSION "$LOCAL_PATH"/assets/pongo_logo.sh
}


function usage {
  case "$1" in
    pongo|init|lint|pack|run|shell|tail|build|nuke|clean|down|restart|status|up|update|expose|logs|docs)
      logo
      if [ -f "$LOCAL_PATH/assets/help/$1.txt" ]; then
        cat "$LOCAL_PATH/assets/help/$1.txt"
      else
        echo "Help for the '$1' command is not yet available"
      fi
      echo ""
      exit 0
      ;;
    *)
      logo
      cat "$LOCAL_PATH/assets/help/pongo.txt"
      echo ""
      exit 1
      ;;
  esac
}


#array_contains arr "a b"  && echo yes || echo no
function array_contains {
  local array="$1[@]"
  local seeking=$2
  local in=1
  local element
  for element in "${!array}"; do
    if [[ "$element" == "$seeking" ]]; then
      in=0
      break
    fi
  done
  return $in
}


function add_custom_dependency {
  local to_add=$1
  if ! array_contains KONG_DEPS_AVAILABLE "$to_add"; then
    KONG_DEPS_AVAILABLE+=("$to_add")
    KONG_DEPS_CUSTOM+=("$to_add")
  fi
}


function read_rc_dependencies {
  local rc_arg
  # shellcheck disable=SC2153  # PONGORC_ARGS is defined in sourced file
  for rc_arg in "${PONGORC_ARGS[@]}"; do
    if [[ "--no-" == "${rc_arg:0:5}" ]]; then
      rc_arg="${rc_arg:5}"
    elif [[ "--" == "${rc_arg:0:2}" ]]; then
      rc_arg="${rc_arg:2}"
    else
      err "not a proper '$PONGORC_FILE' entry: $rc_arg, name must be prefixed with '--' or '--no-'"
    fi
    add_custom_dependency "$rc_arg"
  done;
  #msg "custom deps: ${KONG_DEPS_CUSTOM[@]}"
  #msg "all deps: ${KONG_DEPS_AVAILABLE[@]}"
  local dependency
  for dependency in "${KONG_DEPS_CUSTOM[@]}"; do
    local dcyml
    if [[ -f ".pongo/$dependency.yml" ]]; then
      dcyml=".pongo/$dependency.yml"
    else
      err "docker-compose file '.pongo/$dependency.yml' not found for custom local dependency '$dependency' (specified in '$PONGORC_FILE')"
    fi
    DOCKER_COMPOSE_FILES="$DOCKER_COMPOSE_FILES -f $KONG_TEST_PLUGIN_PATH/$dcyml"
    #msg "compose files: $DOCKER_COMPOSE_FILES"
  done;
}


function add_dependency_start {
  local to_add=$1
  array_contains KONG_DEPS_START "$to_add" && return || KONG_DEPS_START+=("$to_add")
}


function remove_dependency_start {
  local to_remove=$1
  local new_array=()
  local dependency
  for dependency in "${KONG_DEPS_START[@]}"; do
    if [[ "$dependency" != "$to_remove" ]]; then
      new_array+=("$dependency")
    fi
  done;
  KONG_DEPS_START=("${new_array[@]}")
}


function handle_dep_arg {
  local arg=$1
  local is_dep=1
  for dependency in "${KONG_DEPS_AVAILABLE[@]}"; do
    if [[ "--$dependency" == "$arg" ]]; then
      add_dependency_start "$dependency"
      is_dep=0
      break
    fi
    if [[ "--no-$dependency" == "$arg" ]]; then
      remove_dependency_start "$dependency"
      is_dep=0
      break
    fi
  done;
  #msg "after '$arg' deps: ${KONG_DEPS_START[@]} extra-args: ${EXTRA_ARGS[@]}"
  return $is_dep
}


function parse_args {
  read_rc_dependencies
  # inject the RC file commands into the commandline args
  local PONGO_ARGS=()
  # first add the main Pongo command
  local PONGO_COMMAND=$1
  PONGO_ARGS+=("$PONGO_COMMAND")
  shift

  # check for help
  if [ "$PONGO_COMMAND" == "--help" ] || [ "$PONGO_COMMAND" == "-h" ] || [ "$PONGO_COMMAND" == "" ]; then
    usage pongo
  fi
  if [ "$1" == "--help" ] || [ "$1" == "-h" ]; then
    usage "$PONGO_COMMAND"
  fi

  # only add RC file parameters if command allows it
  local rc_command
  for rc_command in "${RC_COMMANDS[@]}"; do
    if [[ "$rc_command" == "$PONGO_COMMAND" ]]; then
      # add all the Pongo RC args
      local rc_arg
      for rc_arg in "${PONGORC_ARGS[@]}"; do
        PONGO_ARGS+=("$rc_arg")
      done;
    fi
  done;

  # add remaining arguments from the command line
  while [[ $# -gt 0 ]]; do
    # option of 'build' or 'run' to add custom CA certificates to the system bundle
    # higher priority than the environment variable
    if [[ "$1" == "--custom-ca-cert" ]] ; then
      PONGO_CUSTOM_CA_CERT="$2"
      PONGO_CUSTOM_CA_CERT_CLI="true"
      shift
    else
      PONGO_ARGS+=("$1")
    fi

    shift
  done

  # parse the arguments
  local args_done=0
  local pongo_arg
  for pongo_arg in "${PONGO_ARGS[@]}"; do
    if [[ args_done -eq 0 ]]; then
      case "$pongo_arg" in
        --)
          args_done=1
          ;;
        --debug)
          # PONGO_DEBUG=true
          set -x
          export BUILDKIT_PROGRESS=plain
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
  if version_exists "$version"; then
    return
  fi
  err "Version '$version' is not supported, supported versions are:
  Kong: ${KONG_CE_VERSIONS[*]} $STABLE_CE $DEVELOPMENT_CE
  Kong Enterprise: ${KONG_EE_VERSIONS[*]} $STABLE_EE $DEVELOPMENT_EE

If the '$version' is valid but not listed, you can try to update Pongo first, and then retry."
}


function check_secret_availability {
  if [[ "$PONGO_SECRETS_AVAILABLE" == "true" ]] || [[ "$PONGO_SECRETS_AVAILABLE" == "" ]]; then
    return 0
  elif [[ "$PONGO_SECRETS_AVAILABLE" == "false" ]]; then
    warn "The required secrets for fetching the image:"
    warn "  '$1'"
    warn "are unavailable, it is assumed this is because of a CI run on"
    warn "a PR from outside the organization, which means it is untrusted."
    warn ""
    warn "If the secrets are available then make sure \$PONGO_SECRETS_AVAILABLE is"
    warn "set to 'true'."
    warn ""
    warn "Now exiting with exit-code 0 to indicate success to not fail external"
    warn "contributed PR's because of CI security restrictions."
    exit 0
  else
    err "variable \$PONGO_SECRETS_AVAILABLE should be 'true', 'false' or unset, but got: '$PONGO_SECRETS_AVAILABLE'"
  fi
}

function docker_login {
  if [[ -z $DOCKER_PASSWORD ]] && [[ -z $DOCKER_USERNAME ]]; then
    # No credentials, nothing to log into
    return 0
  fi

  echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin
  if [[ ! $? -eq 0 ]]; then
    docker logout
    err "Docker login failed. Make sure to provide the proper credentials in the \$DOCKER_USERNAME
and \$DOCKER_PASSWORD environment variables."
  fi
}

function docker_login_ee {
  echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin
  if [[ ! $? -eq 0 ]]; then
    docker logout
    err "Failed to log into the private Kong Enterprise docker repo. Make sure to provide the
proper credentials in the \$DOCKER_USERNAME and \$DOCKER_PASSWORD environment variables."
  fi
}

function get_image {
  # Checks if an image based on $KONG_VERSION is available, if not it will try to
  # download the image.
  # NOTE: the image is an original Kong image, not a development/Pongo one.
  # Result: $KONG_IMAGE will be set to an image based on the requested version
  local image
  # shellcheck disable=SC2153  # will be resolved in set_variables.sh
  if is_commit_based "$KONG_VERSION"; then
    # go and pull the development image here
    if [[ "$KONG_VERSION" == "$DEVELOPMENT_CE" ]]; then
      # pull the Opensource development image
      image=$DEVELOPMENT_CE_TAG
      docker pull "$image"
      if [[ ! $? -eq 0 ]]; then
        err "failed to pull the Kong CE development image $image"
      fi

    else
      # pull the Enterprise development image
      image=$DEVELOPMENT_EE_TAG
      docker pull "$image"
      if [[ ! $? -eq 0 ]]; then
        err "failed to pull: $image"
      fi
    fi

  else
    # regular Kong release, fetch the OSS or Enterprise version if needed
    if is_enterprise "$KONG_VERSION"; then
      image=$KONG_EE_TAG_PREFIX$KONG_VERSION$KONG_EE_TAG_POSTFIX
    else
      image=$KONG_OSS_TAG_PREFIX$KONG_VERSION$KONG_OSS_TAG_POSTFIX
    fi

    docker inspect --type=image "$image" &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      docker pull "$image"
      if [[ ! $? -eq 0 ]]; then
        # failed to pull CE image, so try the fallback
        # NOTE: new releases take a while (days) to become available in the
        # official docker hub repo. Hence we fall back on the unofficial Kong
        # repo that is immediately available for each release. This will
        # prevent any CI from failing in the mean time.
        msg "failed to pull: $image from the official repo, retrying unofficial..."
        image=$KONG_OSS_UNOFFICIAL_TAG_PREFIX$KONG_VERSION$KONG_OSS_UNOFFICIAL_TAG_POSTFIX
        docker pull "$image"
        if [[ ! $? -eq 0 ]]; then
          err "failed to pull: $image"
        fi
        msg "pulling unofficial image succeeded"
      fi
    fi
  fi

  KONG_IMAGE=$image
}


GET_VERSION_RAN=false
function get_version {
  # if $KONG_IMAGE is not yet set, it will get the image (see get_image).
  # Then it will read the Kong version from the image (by executing "kong version")
  #
  # Result: $VERSION will be read from the image, and $KONG_TEST_IMAGE will be set.
  # NOTE1: $KONG_TEST_IMAGE is only a name, the image might not have been created yet
  # NOTE2: if it is a development tag, then $VERSION will be a commit-id
  local custom_image=false
  if [[ -z $KONG_IMAGE ]]; then
    validate_version "$KONG_VERSION"
    get_image
  else
    custom_image=true
    if [[ "$GET_VERSION_RAN" == "false" ]]; then
      # display message only once
      msg "using provided Kong image '$KONG_IMAGE'"
    fi
  fi

  if is_commit_based "$KONG_VERSION"; then
    # it's a development; get the commit-id from the image
    VERSION=$(docker inspect \
       --format "{{ index .Config.Labels \"org.opencontainers.image.revision\"}}" \
       "$KONG_IMAGE")
    if [[ ! $? -eq 0 ]]; then
      err "failed to read commit-id from Kong image: $KONG_IMAGE, label: org.opencontainers.image.revision"
    fi
    if [[ "$VERSION" == "" ]]; then
      err "Got an empty commit-id from Kong image: $KONG_IMAGE, label: org.opencontainers.image.revision"
    fi
    if [[ "$GET_VERSION_RAN" == "false" ]]; then
      # display message only once
      msg "using Kong development/commit based version '$VERSION'"
    fi

  else
    # regular Kong version, so extract the Kong version number
    local cmd=(
      '/bin/bash' '-c' '/usr/local/openresty/luajit/bin/luajit -e "
        local command = [[kong version]]
        local version_output = io.popen(command):read()

        local version_pattern = [[([%d%.%-]+[%d%.])]]
        local parsed_version = version_output:match(version_pattern)

        io.stdout:write(parsed_version)
      "')
    # shellcheck disable=SC2145  # we want WINDOWS_SLASH to be added to the first element
    VERSION=$(docker run --rm -e KONG_LICENSE_DATA "$KONG_IMAGE" "$WINDOWS_SLASH${cmd[@]}")
    if [[ ! $? -eq 0 ]]; then
      err "failed to read version from Kong image: $KONG_IMAGE"
    fi

    # if a custom_iamge, report the version found
    if [[ "$custom_image" == "true" ]]; then
      if [[ "$GET_VERSION_RAN" == "false" ]]; then
        # display message only once
        msg "Kong image '$KONG_IMAGE' reported version '$VERSION'"
      fi
    fi
  fi

  GET_VERSION_RAN=true
  KONG_TEST_IMAGE=$IMAGE_BASE_NAME:$VERSION
}


function compose {
  export NETWORK_NAME
  export SERVICE_NETWORK_NAME
  export KONG_TEST_IMAGE
  export PONGO_WD
  export ACTION
  export PROJECT_ID
  local prefix
  if [ -t 1 ] ; then
    # only use winpty prefix if we're outputting to terminal,
    # hence don't use when piping
    prefix=$WINPTY_PREFIX
  fi

  # shellcheck disable=SC2086  # we need DOCKER_COMPOSE_FILES to be word-split here
  $prefix $COMPOSE_COMMAND -p "${PROJECT_NAME}" ${DOCKER_COMPOSE_FILES} "$@"
}


# checks health status of a container. 2 args:
# 1. container id (required)
# 2. container name (optional, defaults to the id)
# returns 0 (success) if healthy, 1 for all other states; starting, unhealthy, stopping, etc.
function healthy {
  local iid=$1
  [[ -z $iid ]] && return 1

  local name=$2
  if [[ "$name" == "" ]]; then
    # no name provided, use container id
    name=$iid
  fi

  if [[ "${SERVICE_DISABLE_HEALTHCHECK}" == "true" ]]; then
    return 0
  fi

  local health
  health=$(docker inspect --format='{{json .State.Health}}' "$iid")

  if [ "$health" == "null" ]; then
    msg "No health check available for '$name', assuming healthy"
    return 0
  fi

  local state
  state=$(docker inspect --format='{{.State.Health.Status}}' "$iid")

  if [ "$state" == "healthy" ]; then
    return 0
  fi
  return 1
}


# takes a container name and returns its id
function cid {
  compose ps -q "$1" 2> /dev/null
}


# Waits for a dependency to be healthy. 1 arg:
# 1. dependency name
# returns 0 (success) if healthy, throws an error if there was a timeout
function wait_for_dependency {
  local iid
  local dep="$1"

  if [[ "${SERVICE_DISABLE_HEALTHCHECK}" == "true" ]]; then
    msg "Health checks disabled, won't wait for '$dep' to be healthy"
    return 0
  fi

  iid=$(cid "$dep")

  if healthy "$iid" "$dep"; then
    return 0
  fi

  msg "Waiting for '$dep' to become healthy"

  local timeout_count=$((HEALTH_TIMEOUT*2))
  while [ $timeout_count -ge 0 ]; do
    sleep 0.5
    if healthy "$iid" "$dep"; then
      return 0
    fi
    timeout_count=$((timeout_count-1))
  done

  err "Timeout waiting for '$dep' to become healthy"
}


function compose_up {
  docker_login
  local dependency
  for dependency in "${KONG_DEPS_START[@]}"; do
    healthy "$(cid "$dependency")" "$dependency" || compose up -d "$dependency"
  done;
}


function ensure_available {
  if [ -z "$WINDOWS_SLASH" ]; then
    # unix check
    compose ps | grep "Up (health" &> /dev/null
  else
    # Windows check
    compose ps | grep "running (health" &> /dev/null
  fi
  if [[ ! $? -eq 0 ]]; then
    msg "auto-starting the test environment, use the 'pongo down' action to stop it"
    compose_up || err "failed to start the test environment"
  fi

  local dependency
  for dependency in "${KONG_DEPS_START[@]}"; do
    wait_for_dependency "$dependency"
  done;
}


function verify_custom_ca_cert {
  if [[ -z "${PONGO_CUSTOM_CA_CERT:+x}" ]] ; then
    # found option '--custom-ca-cert' but no cert file provided
    if [[ "$PONGO_CUSTOM_CA_CERT_CLI" == "true" ]] ; then
      err "Custom CA certificates file is not set." \
          "You can provide a custom CA certificates in PEM format using the '--custom-ca-cert <my-ca.crt>' option" \
          "or the 'PONGO_CUSTOM_CA_CERT=<my-ca.crt>' environment variable."
    else
      # assume it is not needed
      return 0
    fi
  fi

  if [[ ! -e "$PONGO_CUSTOM_CA_CERT" ]] ; then
    err "Custom CA certificates file '${PONGO_CUSTOM_CA_CERT}' does not exist." \
        "You can provide a CA certificates in PEM format using the '--custom-ca-cert <my-ca.crt>' option or" \
        "the 'PONGO_CUSTOM_CA_CERT=<my-ca.crt>' environment variable."
  fi

  local cert
  cert=$(realpath "$PONGO_CUSTOM_CA_CERT")
  if [[ "$cert" != "$PONGO_CUSTOM_CA_CERT" ]] ; then
    msg "Resolving custom CA certificates file '${PONGO_CUSTOM_CA_CERT}' to real path '${cert}'."
    PONGO_CUSTOM_CA_CERT="$cert"
  fi

  if [[ ! -f "$PONGO_CUSTOM_CA_CERT" ]] ; then
    err "Custom CA certificates file '${PONGO_CUSTOM_CA_CERT}' does not exist." \
        "You can provide a CA certificates in PEM format using the '--custom-ca-cert <my-ca.crt>' option or" \
        "the 'PONGO_CUSTOM_CA_CERT=<my-ca.crt>' environment variable."
  fi

  # only required when verifying custom CA certificates
  if ! command -v openssl >/dev/null 2>&1 ; then
    err "'openssl' command not found, can not verify the custom CA certificates." \
        "You can install OpenSSL and make it available in the path."
  fi

  # check if the file is a valid PEM certificate
  if ! openssl x509 -inform pem -in "$PONGO_CUSTOM_CA_CERT" -noout >/dev/null 2>&1 ; then
    err "Custom CA certificates file '${PONGO_CUSTOM_CA_CERT}' is not a valid PEM certificate."
  fi

  msg "Loading custom CA certificates '${PONGO_CUSTOM_CA_CERT}'." \
      "Please Verify the Identity and Authenticity of the CAs and Certificates."
}


function build_image {
  # if $KONG_TEST_IMAGE doesn't exist yet (or if forced), it will build that
  # image. This essentially comes down to:
  # 1. take $KONG_IMAGE as base image
  # 2. inject dev files based on $VERSION
  # 3. do a 'make dev' and then some (see the Dockerfile)
  # 4. Tag the result as $KONG_TEST_IMAGE
  get_version
  if is_commit_based "$KONG_VERSION"; then
    # in a development then $VERSION is a commit id
    validate_version "$KONG_VERSION"
  else
    # regular version or an image provided, check $VERSION extracted from the image
    validate_version "$VERSION"
  fi

  docker inspect --type=image "$KONG_TEST_IMAGE" &> /dev/null
  if [[ $? -eq 0 ]]; then
    msg "image '$KONG_TEST_IMAGE' already exists"
    if [ "$FORCE_BUILD" = false ] ; then
      msg "use 'pongo build --force' to rebuild"
      return 0
    fi
    msg "rebuilding..."
  fi

  if is_commit_based "$KONG_VERSION"; then
    # development; we must fetch the related development files dynamically in this case
    # shellcheck disable=SC1090  # do not follow source
    source "${LOCAL_PATH}/assets/update_versions.sh"
    update_development "$KONG_VERSION" "$VERSION"
  fi

  verify_custom_ca_cert
  local custom_ca_cert_basename
  local dest_ca_cert_pathname
  if [[ -n "$PONGO_CUSTOM_CA_CERT" ]] ; then
    custom_ca_cert_basename=$(basename "$PONGO_CUSTOM_CA_CERT")
    dest_ca_cert_pathname="${LOCAL_PATH}/assets/pongo_ca_$custom_ca_cert_basename"

    if [[ -e "$dest_ca_cert_pathname" ]] ; then
      err "Custom CA certificates file '${dest_ca_cert_pathname}' already exists, please remove it first."
    fi

    cp "$PONGO_CUSTOM_CA_CERT" "$dest_ca_cert_pathname"
  fi

  msg "starting build of image '$KONG_TEST_IMAGE'"
  # shellcheck disable=SC2086 # DOCKER_BUILD_EXTRA_ARGS can contain multiple arguments so we must not quote it
  $WINPTY_PREFIX docker build \
    -f "$DOCKER_FILE" \
    --build-arg PONGO_VERSION="$PONGO_VERSION" \
    --build-arg http_proxy="$http_proxy" \
    --build-arg https_proxy="$https_proxy" \
    --build-arg ftp_proxy="$ftp_proxy" \
    --build-arg no_proxy="$no_proxy" \
    --build-arg PONGO_INSECURE="$PONGO_INSECURE" \
    --build-arg PONGO_CUSTOM_CA_CERT="pongo_ca_$custom_ca_cert_basename" \
    --build-arg KONG_BASE="$KONG_IMAGE" \
    --build-arg KONG_DEV_FILES="./kong-versions/$VERSION/kong" \
    --tag "$KONG_TEST_IMAGE" \
    ${DOCKER_BUILD_EXTRA_ARGS} \
    "$LOCAL_PATH" || err "Error: failed to build test environment"

  if [[ -e "$dest_ca_cert_pathname" ]] ; then
    rm -f "$dest_ca_cert_pathname" >/dev/null 2>&1
  fi

  msg "image '$KONG_TEST_IMAGE' successfully build"
}


function get_plugin_names {
  if [[ -d ./kong/plugins/ ]]; then
    local dir
    # shellcheck disable=SC2044  # let's trust the files to not have space in them
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


function do_prerun_script {
  if [[ -f .pongo/pongo-setup-host.sh ]]; then
    # shellcheck disable=SC1091  # not following sourced script
    PONGO_COMMAND="$ACTION" .pongo/pongo-setup-host.sh

    if [[ $? -ne 0 ]]; then
      err "prerun script '.pongo/pongo-setup-host.sh' failed"
    fi
  fi
}


function pongo_down {
  # if '--all' is passed then kill all environments, otherwise just current
  if [[ ! "$1" == "--all" ]]; then
    # just current env
    compose down --remove-orphans --volumes
    exit
  fi

  # use 'docker network ls' command to find networks, and kill them all
  local p_id=$PROJECT_ID
  local p_name=$PROJECT_NAME
  local snn=$SERVICE_NETWORK_NAME

  while read -r network ; do
    PROJECT_ID=${network: -8}
    PROJECT_NAME=${PROJECT_NAME_PREFIX}${PROJECT_ID}
    SERVICE_NETWORK_NAME=${SERVICE_NETWORK_PREFIX}${PROJECT_ID}
    compose down --remove-orphans --volumes
  done < <(docker network ls --filter 'name='$SERVICE_NETWORK_PREFIX --format '{{.Name}}')

  PROJECT_ID=$p_id
  PROJECT_NAME=$p_name
  SERVICE_NETWORK_NAME=$snn
}


function pongo_clean {
  pongo_down --all

  docker images --filter=reference="${IMAGE_BASE_PREFIX}*:*" --format "found: {{.ID}}" | grep found
  if [[ $? -eq 0 ]]; then
    # shellcheck disable=SC2046  # we want the image ids to be word-splitted
    docker rmi $(docker images --filter=reference="${IMAGE_BASE_PREFIX}*:*" --format "{{.ID}}")
  fi

  docker images --filter=reference="pongo-expose:*" --format "found: {{.ID}}" | grep found
  if [[ $? -eq 0 ]]; then
    # shellcheck disable=SC2046  # we want the image ids to be word-splitted
    docker rmi $(docker images --filter=reference="pongo-expose:*" --format "{{.ID}}")
  fi

  # prune to prevent rebuilding to happen from the docker build cache
  docker builder prune -f

  if [ -d "$LOCAL_PATH/kong" ]; then
    rm -rf "$LOCAL_PATH/kong"
  fi
  if [ -d "$LOCAL_PATH/kong-ee" ]; then
    rm -rf "$LOCAL_PATH/kong-ee"
  fi
}


function pongo_expose {
  local dependency="expose"
  healthy "$(cid "$dependency")" "$dependency" || compose up -d "$dependency" || err "failed to start '$dependency'"
  wait_for_dependency "$dependency"
}


function pongo_logs {
  compose logs "${EXTRA_ARGS[@]}"
}


function pongo_status {
  if [ ${#EXTRA_ARGS[@]} -eq 0 ]; then
    # default; do all
    EXTRA_ARGS=(networks dependencies containers images versions)
  fi

  local project="${PROJECT_NAME}"
  for arg in "${EXTRA_ARGS[@]}"; do
    if [ "$arg" == "--all" ]; then
      # we need to show everything, so do not grep for project ID
      # but use the generic part of the name to list all pongo envs
      project="pongo-"

      if [ ${#EXTRA_ARGS[@]} -eq 1 ]; then
        # only --all specified, so use defaults
        EXTRA_ARGS=(networks dependencies containers images versions)
      fi
    fi
  done

  local arg
  local nl
  for arg in "${EXTRA_ARGS[@]}"; do
    if [ "$nl" == true ]; then
      echo
    else
      nl=true
    fi

    case "$arg" in
      networks)
        echo Pongo networks:
        echo ===============
        docker network ls | grep "${project}"
        ;;

      dependencies)
        echo Pongo available dependencies:
        echo =============================
        local dep_name
        for dep_name in "${KONG_DEPS_AVAILABLE[@]}"; do
          if array_contains KONG_DEPS_CUSTOM "$dep_name"; then
            echo "$dep_name (custom to local plugin)"
          else
            echo "$dep_name"
          fi
        done;
        ;;

      containers)
        echo Pongo containers:
        echo =================
        docker ps | grep "${project}"
        ;;

      images)
        echo Pongo cached images:
        echo ====================
        docker images --filter=reference="${IMAGE_BASE_PREFIX}*:*"
        ;;

      versions)
        echo Available Kong versions:
        echo ========================
        echo Kong: "${KONG_CE_VERSIONS[*]}" "$STABLE_CE $DEVELOPMENT_CE"
        echo Kong Enterprise: "${KONG_EE_VERSIONS[*]}" "$STABLE_EE $DEVELOPMENT_EE"
        ;;

      --all)
        ;;

      *)
        err "unknown option: '$arg', see 'pongo status --help'"
    esac
  done
}


function pongo_init {
  local pluginname
  # derive pluginname
  if [[ -d ./kong/plugins/ ]]; then
    local dir
    # shellcheck disable=SC2044  # let's trust the files to not have space in them
    for dir in $(find ./kong/plugins -maxdepth 1 -mindepth 1 -type d); do
      dir=${dir##*/}    # grab everything after the final "/"
      msg "found plugin directory: ./kong/plugins/$dir"
      if [[ "$pluginname" == "" ]]; then
        # found a name
        pluginname=$dir
      elif [[ ! "$pluginname" == "@" ]]; then
        # found multiple names
        pluginname="@"
      fi
    done
  fi
  if [[ "$pluginname" == "" ]]; then
    msg "no plugin-code folders found, e.g. './kong/plugins/<plugin_name>'"
  fi

  if [[ "$pluginname" == "" ]]; then
    local dirname
    dirname=$(basename -- "$(pwd)")
    if [[ "kong-plugin-" == "${dirname:0:12}" ]]; then
      pluginname=${dirname#"kong-plugin-"}
      msg "found current working directory; ./kong-plugin-$pluginname"
    fi
  fi

  if [[ "$pluginname" == "" ]]; then
    msg "current working dir has no plugin name, e.g. 'kong-plugin-<plugin_name>'"
    err "could not detect current working dir to be a kong-plugin dir."
  fi

  if [ -f ".busted" ]; then
    msg "'.busted' config file already present"
  else
    cp "$LOCAL_PATH/assets/init/busted" .busted
    msg "added '.busted' config file for the Busted test framework"
  fi

  if [ -f ".luacov" ]; then
    msg "'.luacov' config file already present"
  else
    cp "$LOCAL_PATH/assets/init/luacov" .luacov
    msg "added '.luacov' config file for the LuaCov test coverage tool"
  fi

  if [ -f ".editorconfig" ]; then
    msg "'.editorconfig' config file already present"
  else
    cp "$LOCAL_PATH/assets/init/editorconfig" .editorconfig
    msg "added '.editorconfig' config file with editor defaults and style items"
  fi

  if [ -f ".luacheckrc" ]; then
    msg "'.luacheckrc' config file already present"
  else
    cp "$LOCAL_PATH/assets/init/luacheckrc" .luacheckrc
    msg "added '.luacheckrc' config file for the LuaCheck linter"
  fi

  if [ -f ".pongo/pongorc" ]; then
    msg "'.pongo/pongorc' config file already present"
  else
    if [ ! -d ".pongo" ]; then
      mkdir .pongo
    fi
    touch .pongo/pongorc

    local dep_name
    for dep_name in "${KONG_DEPS_AVAILABLE[@]}"; do
      if array_contains KONG_DEPS_START "$dep_name"; then
        echo "--$dep_name" >> .pongo/pongorc
      #else
      #  echo "--no-$dep_name" >> .pongo/pongorc
      fi
    done;
    msg "added '.pongo/pongorc' config file for Pongo test dependencies"
  fi

  if [ ! -f ".gitignore" ]; then
    touch .gitignore
  fi
  if grep --quiet ^servroot$ .gitignore ; then
    msg "'.gitignore' already ignores 'servroot'"
  else
    echo "# servroot typically is the Kong working directory for tests" >> .gitignore
    echo "servroot" >> .gitignore
    msg "added 'servroot' to '.gitignore'"
  fi
  if grep --quiet "^[*][.]rock$" .gitignore ; then
    msg "'.gitignore' already ignores '*.rock'"
  else
    echo "# exclude generated packed rocks" >> .gitignore
    echo "*.rock" >> .gitignore
    msg "added '*.rock' to '.gitignore'"
  fi
  if grep --quiet "^[.]pongo/[.]bash_history$" .gitignore ; then
    msg "'.gitignore' already ignores '.pongo/.bash_history'"
  else
    echo "# exclude Pongo shell history" >> .gitignore
    echo ".pongo/.bash_history" >> .gitignore
    msg "added '.pongo/.bash_history' to '.gitignore'"
  fi
  if grep --quiet "^luacov[.]stats[.]out$" .gitignore ; then
    msg "'.gitignore' already ignores 'luacov.stats.out'"
  else
    echo "# exclude LuaCov statistics file" >> .gitignore
    echo "luacov.stats.out" >> .gitignore
    msg "added 'luacov.stats.out' to '.gitignore'"
  fi
  if grep --quiet "^luacov[.]report[.]out$" .gitignore ; then
    msg "'.gitignore' already ignores 'luacov.report.out'"
  else
    echo "# exclude LuaCov report" >> .gitignore
    echo "luacov.report.out" >> .gitignore
    msg "added 'luacov.report.out' to '.gitignore'"
  fi
  if grep --quiet "^luacov[.]report[.]html$" .gitignore ; then
    msg "'.gitignore' already ignores 'luacov.report.html'"
  else
    echo "# exclude LuaCov html report" >> .gitignore
    echo "luacov.report.html" >> .gitignore
    msg "added 'luacov.report.html' to '.gitignore'"
  fi
  if grep --quiet "^[.]containerid$" .gitignore ; then
    msg "'.gitignore' already ignores '.containerid'"
  else
    echo "# exclude Pongo containerid file" >> .gitignore
    echo ".containerid" >> .gitignore
    msg "added '.containerid' to '.gitignore'"
  fi
}


function main {
  parse_args "$@"

  ACTION=${EXTRA_ARGS[0]}; unset 'EXTRA_ARGS[0]'

  case "$ACTION" in

  build)
    if [[ "${EXTRA_ARGS[1]}" == "--force" ]]; then
      FORCE_BUILD=true
    fi
    build_image
    ;;

  up)
    compose_up
    ;;

  down)
    pongo_down "${EXTRA_ARGS[1]}"
    ;;

  restart)
    compose down --remove-orphans --volumes
    compose_up
    ;;

  tail)
    local tail_file="${EXTRA_ARGS[1]}"
    if [[ "$tail_file" == "" ]]; then
      tail_file="./servroot/logs/error.log"
    fi

    if [[ ! -f $tail_file ]]; then
      msg "waiting for tail file to appear: $tail_file"
      local index=1
      while [ $index -le 300 ]
      do
        if [[ -f $tail_file ]]; then
          break
        fi
        ((index++))
        sleep 1
      done
    fi

    tail -F "$tail_file"
    ;;

  run)
    ensure_available
    get_version

    docker inspect --type=image "$KONG_TEST_IMAGE" &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "image '$KONG_TEST_IMAGE' not found, auto-building it"
      build_image
    fi

    # figure out where in the arguments list the file-list starts
    local files_start_index=1
    local index=1
    local arg
    for arg in "${EXTRA_ARGS[@]}"; do
      if [[ ! -f $arg ]] && [[ ! -d $arg ]]; then
        # arg does not exist as a file, so files start at the
        # next index at the earliest
        ((files_start_index = index + 1))
      fi
      ((index++))
    done

    local busted_params=()
    local busted_files=()
    index=1
    for arg in "${EXTRA_ARGS[@]}"; do
      if [[ "$index" -lt "$files_start_index" ]]; then
        busted_params+=( "$arg" )
      else
        # substitute absolute host path for absolute docker path
        local c_path
        c_path=$(realpath "$arg" | sed "s/${KONG_TEST_PLUGIN_PATH////\\/}/\/kong-plugin/")
        busted_files+=( "$c_path" )
      fi
      ((index++))
    done

    if [[ ${#busted_files[@]} -eq 0 ]]; then
      # no paths given, so set up the busted default: ./spec
      busted_files+=( "/kong-plugin/spec" )
    fi

    do_prerun_script

    compose run --rm --use-aliases \
      -e KONG_LICENSE_DATA \
      -e KONG_TEST_DONT_CLEAN \
      -e KONG_TEST_FIPS \
      -e http_proxy \
      -e https_proxy \
      -e no_proxy \
      -e ftp_proxy \
      -e PONGO_CLIENT_VERSION="$PONGO_VERSION" \
      kong \
      "$WINDOWS_SLASH/bin/bash" "-c" "bin/busted --helper=$WINDOWS_SLASH/pongo/busted_helper.lua ${busted_params[*]} ${busted_files[*]}"
    ;;

  shell)
    get_plugin_names
    get_version
    docker inspect --type=image "$KONG_TEST_IMAGE" &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "image '$KONG_TEST_IMAGE' not found, auto-building it"
      build_image
    fi

    local repository_name=${KONG_TEST_PLUGIN_PATH##*/}
    local shellprompt
    if is_enterprise "$KONG_VERSION"; then
      shellprompt="Kong-E-$KONG_VERSION"
    else
      shellprompt="Kong-$KONG_VERSION"
    fi

    local cleanup
    if [ -d "./servroot" ]; then
      cleanup=false
    else
      cleanup=true
    fi

    local exec_cmd="${EXTRA_ARGS[*]}"
    local suppress_kong_version="true"
    local script_mount=""
    if [[ "$exec_cmd" == "" ]]; then
      # no args, so plain shell, use -l to login and run profile scripts
      exec_cmd="$WINDOWS_SLASH/bin/bash -l"
      suppress_kong_version="false"
    elif [[ "${exec_cmd:0:1}" == "@" ]]; then
      # a script file as argument
      local script=${EXTRA_ARGS[1]}
      script=${script:1}
      script=$(realpath "$script")
      if [ ! -f "$script" ]; then
        err "Not a valid script filename: $script"
      fi
      script_mount="-v $script:/kong/bin/shell_script.sh"
      exec_cmd="$WINDOWS_SLASH/bin/bash /kong/bin/shell_script.sh"
    fi

    local history_mount=""
    local history_file=".pongo/.bash_history"
    if [ -d ".pongo" ]; then
      touch "$history_file"
      history_file="$PONGO_WD/$history_file"
      history_mount="-v $history_file:/root/.bash_history"
    fi

    do_prerun_script

    # shellcheck disable=SC2086 # we explicitly want script_mount & exec_cmd to be splitted
    compose run --rm --use-aliases \
      -e KONG_LICENSE_DATA \
      -e PONGO_CLIENT_VERSION="$PONGO_VERSION" \
      -e http_proxy \
      -e https_proxy \
      -e no_proxy \
      -e ftp_proxy \
      -e KONG_LOG_LEVEL \
      -e KONG_ANONYMOUS_REPORTS \
      -e SUPPRESS_KONG_VERSION="$suppress_kong_version" \
      -e KONG_PG_DATABASE="kong_tests" \
      -e KONG_PLUGINS="$PLUGINS" \
      -e KONG_CUSTOM_PLUGINS="$CUSTOM_PLUGINS" \
      -e PS1_KONG_VERSION="$shellprompt" \
      -e PS1_REPO_NAME="$repository_name" \
      $script_mount \
      $history_mount \
      kong $exec_cmd

    local result=$?

    if [[ "$cleanup" == "true" ]]; then
      rm -rf "./servroot"
    fi

    exit $result
    ;;

  lint)
    get_plugin_names
    get_version
    docker inspect --type=image "$KONG_TEST_IMAGE" &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "image '$KONG_TEST_IMAGE' not found, auto-building it"
      build_image
    fi
    compose run --rm \
      --workdir="$WINDOWS_SLASH/kong-plugin" \
      -e KONG_LICENSE_DATA \
      -e PONGO_CLIENT_VERSION="$PONGO_VERSION" \
      -e KONG_LOG_LEVEL \
      -e KONG_ANONYMOUS_REPORTS \
      -e KONG_PG_DATABASE="kong_tests" \
      -e KONG_PLUGINS="$PLUGINS" \
      -e KONG_CUSTOM_PLUGINS="$CUSTOM_PLUGINS" \
      kong luacheck .
    ;;

  pack)
    get_plugin_names
    get_version
    docker inspect --type=image "$KONG_TEST_IMAGE" &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "image '$KONG_TEST_IMAGE' not found, auto-building it"
      build_image
    fi
    compose run --rm \
      --workdir="$WINDOWS_SLASH/kong-plugin" \
      -e KONG_LICENSE_DATA \
      -e PONGO_CLIENT_VERSION="$PONGO_VERSION" \
      -e http_proxy \
      -e https_proxy \
      -e no_proxy \
      -e ftp_proxy \
      -e KONG_LOG_LEVEL \
      -e KONG_ANONYMOUS_REPORTS \
      -e KONG_PG_DATABASE="kong_tests" \
      -e KONG_PLUGINS="$PLUGINS" \
      -e KONG_CUSTOM_PLUGINS="$CUSTOM_PLUGINS" \
      kong $WINDOWS_SLASH/pongo/pongo_pack.lua
    ;;

  update)
    # shellcheck disable=SC1090  # do not follow source
    source "${LOCAL_PATH}/assets/update_versions.sh"
    update_artifacts
    exit $?
    ;;

  status)
    pongo_status
    ;;

  init)
    pongo_init
    ;;

  clean)
    pongo_clean
    ;;

  nuke)
    pongo_clean
    ;;

  expose)
    pongo_expose
    ;;

  docs)
    local tdir=${TMPDIR-/tmp}
    if [ -n "$TMPDIR" ]; then
      tdir=$TMPDIR
    elif [ -n "$TEMP" ]; then
      tdir=$TEMP
    elif [ -n "$TMP" ]; then
      tdir=$TMP
    else
      tdir="/tmp"
    fi
    if [ ! "${tdir: -1}" = "/" ]; then
      tdir="$tdir"/
    fi
    local subd="kong-test-helper-docs/"


    if [ -d "$tdir$subd" ]; then
      if [[ "${EXTRA_ARGS[1]}" == "--force" ]]; then
        rm -rf "$tdir$subd"
      else
        msg "using pre-rendered docs, use '--force' to rebuild"
      fi
    fi
    if [ ! -d "$tdir$subd" ]; then
      # temp dev-docs dir does not exist, go render the docs
      get_plugin_names
      get_version
      docker inspect --type=image "$KONG_TEST_IMAGE" &> /dev/null
      if [[ ! $? -eq 0 ]]; then
        msg "image '$KONG_TEST_IMAGE' not found, auto-building it"
        build_image
      fi
      compose run --rm \
        --workdir="$WINDOWS_SLASH/kong/spec" \
        -e KONG_LICENSE_DATA \
        -e PONGO_CLIENT_VERSION="$PONGO_VERSION" \
        -e KONG_PLUGINS="$PLUGINS" \
        -e KONG_CUSTOM_PLUGINS="$CUSTOM_PLUGINS" \
        kong ldoc --dir=$WINDOWS_SLASH/kong-plugin/$subd .
      if [[ ! $? -eq 0 ]]; then
        err "failed to render the Kong development docs"
      fi
      mv kong-test-helper-docs "$tdir$subd"
    fi

    # try and open the docs in the default browser
    msg "Open docs from: ""$tdir$subd""index.html"
    if [ -z "$WINDOWS_SLASH" ]; then
      open "$tdir$subd""index.html" > /dev/null 2>&1
    else
      powershell -Command "$tdir$subd""index.html" > /dev/null 2>&1
    fi
    echo ""
    ;;

  logs)
    pongo_logs
    ;;

  *)
    usage
    ;;
  esac
}


check_tools
globals
main "$@"
