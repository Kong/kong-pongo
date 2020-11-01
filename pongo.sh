#!/usr/bin/env bash

# use the "--debug" flag to debug this script; setting the "set -x" option

function globals {
  # Project related global variables
  LOCAL_PATH=$(dirname "$(realpath "$0")")
  DOCKER_FILE=${LOCAL_PATH}/assets/Dockerfile
  DOCKER_COMPOSE_FILES="-f ${LOCAL_PATH}/assets/docker-compose.yml"
  PROJECT_NAME=kong-pongo
  NETWORK_NAME=pongo-test-network
  SERVICE_NETWORK_NAME=${PROJECT_NAME}
  IMAGE_BASE_NAME=${PROJECT_NAME}-test
  KONG_TEST_PLUGIN_PATH=$(realpath .)
  PONGO_WD=$KONG_TEST_PLUGIN_PATH
  if [[ -f "$KONG_TEST_PLUGIN_PATH/.pongo/pongorc" ]]; then
    PONGORC_FILE=".pongo/pongorc"
  elif [[ -f "$KONG_TEST_PLUGIN_PATH/.pongorc" ]]; then
    # for backward compatibility
    PONGORC_FILE=".pongorc"
  else
    PONGORC_FILE=".pongo/pongorc"
  fi

  # when running CI do we have the required secrets available? (used for EE only)
  # secrets are unavailable for PR's from outside the organization (untrusted)
  # can be set to "true" or "false", defaults to the Travis-CI setting
  if [[ "$PONGO_SECRETS_AVAILABLE" == "" ]]; then
    PONGO_SECRETS_AVAILABLE="$TRAVIS_SECURE_ENV_VARS"
  fi

  # regular Kong Enterprise images repo (tag is build as $PREFIX$VERSION$POSTFIX).
  # Set credentials in $BINTRAY_APIKEY and $BINTRAY_USERNAME
  KONG_EE_REPO="kong-docker-kong-enterprise-edition-docker.bintray.io"
  KONG_EE_TAG_PREFIX="kong-docker-kong-enterprise-edition-docker.bintray.io/kong-enterprise-edition:"
  KONG_EE_TAG_POSTFIX="-alpine"

  # regular Kong CE images repo (tag is build as $PREFIX$VERSION$POSTFIX)
  KONG_OSS_TAG_PREFIX="kong:"
  KONG_OSS_TAG_POSTFIX="-alpine"
  # unoffical Kong CE images repo, the fallback
  KONG_OSS_TAG_FALLBACK_PREFIX="kong/kong:"
  KONG_OSS_TAG_FALLBACK_POSTFIX=

  # Nightly EE images repo, these require to additionally set the credentials
  # in $NIGHTLY_EE_APIKEY and $NIGHTLY_EE_USER
  NIGHTLY_EE_DOCKER_REPO="registry.kongcloud.io"
  NIGHTLY_EE_TAG="registry.kongcloud.io/kong-ee-dev-master:latest"

  # Nightly CE images, these are public, no credentials needed
  NIGHTLY_CE_TAG="kong/kong:latest"

  # Commandline related variables
  unset ACTION
  FORCE_BUILD=false
  KONG_DEPS_AVAILABLE=( "postgres" "cassandra" "redis" "squid" "grpcbin" "expose")
  KONG_DEPS_START=( "postgres" "cassandra" )
  KONG_DEPS_CUSTOM=()
  RC_COMMANDS=( "run" "up" "restart" )
  EXTRA_ARGS=()

  # shellcheck disable=SC1090  # do not follow source
  source "${LOCAL_PATH}/assets/set_variables.sh"
  # resolve a '.x' to a real version; eg. "1.3.0.x" in $KONG_VERSION
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

  docker-compose -v > /dev/null 2>&1
  if [[ ! $? -eq 0 ]]; then
    >&2 echo "'docker-compose' command not found, please install docker-compose, and make it available in the path."
    missing=true
  fi

  realpath --version > /dev/null 2>&1
  if [[ ! $? -eq 0 ]]; then
    >&2 echo "'realpath' command not found, please install it, and make it available in the path (on Mac use Brew to install the 'coreutils' package)."
    missing=true
  fi

  curl -V > /dev/null 2>&1
  if [[ ! $? -eq 0 ]]; then
    >&2 echo "'curl' command not found, please install it, and make it available in the path."
    missing=true
  fi

  if [[ "$missing" == "true" ]]; then
    >&2 echo -e "\033[0;31m[pongo-ERROR] the above dependencies are missing, install and retry.\033[0m"
    exit 1
  fi
}


function check_docker {
  # Are we running Pongo itself inside a container?
  # $PONGO_WD will contain the path FOR THE HOST, that maps to
  # $KONG_TEST_PLUGIN_PATH in the container that runs Pongo (=this code)
  local PONGO_CONTAINER_ID
  local HOST_PATH
  if [[ -d "/pongo_wd" ]]; then
    PONGO_CONTAINER_ID=$(grep "memory:/" < /proc/self/cgroup | sed 's|.*/||')
    if [[ "$PONGO_CONTAINER_ID" == "" ]]; then
      warn "'/pongo_wd' path is defined, but failed to get the container id."
      warn "If you are NOT running Pongo itself inside a container, then make"
      warn "sure '/pongo_wd' doesn't exist."
    else
      #msg "Pongo container: $PONGO_CONTAINER_ID"
      HOST_PATH=$(docker inspect "$PONGO_CONTAINER_ID" | grep ":/pongo_wd\"" | sed -e 's/^[ \t]*//' | sed s/\"//g | grep -o "^[^:]*")
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
}


function logo {
local BLUE='\033[0;36m'
local BROWN='\033[1;33m'
echo -e "${BLUE}"
echo -e "                ${BROWN}/~\\ ${BLUE}"
echo -e "  ______       ${BROWN}C oo${BLUE}"
echo -e "  | ___ \      ${BROWN}_( ^)${BLUE}"
echo -e "  | |_/ /__  _${BROWN}/${BLUE}__ ${BROWN}~\ ${BLUE}__   ___"
echo -e "  |  __/ _ \| '_ \ ${BROWN}/${BLUE} _\` |/ _ \\"
echo -e "  | | | (_) | | | | (_| | (_) |"
echo -e "  \_|  \___/|_| |_|\__, |\___/"
echo -e "                    __/ |"
echo -e "                   |___/"
echo -e "\033[0m"
}


function usage {
  case "$1" in
    pongo|init|lint|pack|run|shell|tail|build|nuke|clean|down|restart|status|up|update|expose)
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
  for rc_arg in ${PONGORC_ARGS[*]}; do
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
  for dependency in ${KONG_DEPS_CUSTOM[*]}; do
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
  for rc_command in ${RC_COMMANDS[*]}; do
    if [[ "$rc_command" == "$PONGO_COMMAND" ]]; then
      # add all the Pongo RC args
      local rc_arg
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
  local pongo_arg
  for pongo_arg in ${PONGO_ARGS[*]}; do
    if [[ args_done -eq 0 ]]; then
      case "$pongo_arg" in
        --)
          args_done=1
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
  if version_exists "$version"; then
    return
  fi
  err "Version '$version' is not supported, supported versions are:
  Kong: ${KONG_CE_VERSIONS[*]} ($NIGHTLY_CE)
  Kong Enterprise: ${KONG_EE_VERSIONS[*]} ($NIGHTLY_EE)

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


function get_image {
  # Checks if an image based on $KONG_VERSION is available, if not it will try to
  # download the image. This might include logging into bintray to get an Enterprise
  # version image.
  # NOTE: the image is a plain Kong image, not a development/Pongo one.
  # Result: $KONG_IMAGE will be set to an image based on the requested version
  local image
  if is_nightly "$KONG_VERSION"; then
    # go and pull the nightly image here
    if [[ "$KONG_VERSION" == "$NIGHTLY_CE" ]]; then
      # pull the Opensource Nightly image
      image=$NIGHTLY_CE_TAG
      docker pull $image
      if [[ ! $? -eq 0 ]]; then
        err "failed to pull the Kong CE nightly image $image"
      fi

    else
      # pull the Enterprise nightly image
      image=$NIGHTLY_EE_TAG
      docker pull $image
      if [[ ! $? -eq 0 ]]; then
        warn "failed to pull the Kong Enterprise nightly image, retrying with login..."
        check_secret_availability "$image"
        echo "$NIGHTLY_EE_APIKEY" | docker login -u "$NIGHTLY_EE_USER" --password-stdin "$NIGHTLY_EE_DOCKER_REPO"
        if [[ ! $? -eq 0 ]]; then
          docker logout $NIGHTLY_EE_DOCKER_REPO
          err "Failed to log into the nightly Kong Enterprise docker repo. Make sure to provide the
proper credentials in the \$NIGHTLY_EE_USER and \$NIGHTLY_EE_APIKEY environment variables."
        fi
        docker pull $image
        if [[ ! $? -eq 0 ]]; then
          docker logout $NIGHTLY_EE_DOCKER_REPO
          err "failed to pull: $image"
        fi
        msg "pull with login succeeded"
        docker logout $NIGHTLY_EE_DOCKER_REPO
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
        warn "failed to pull image $image"
        if is_enterprise "$KONG_VERSION"; then
          # failed to pull Enterprise, so login and retry
          msg "trying to login to Kong docker repo and retry..."
          check_secret_availability "$image"
          echo "$BINTRAY_APIKEY" | docker login -u "$BINTRAY_USERNAME" --password-stdin "$KONG_EE_REPO"
          if [[ ! $? -eq 0 ]]; then
            docker logout $KONG_EE_REPO
            err "Failed to log into the Kong docker repo. Make sure to provide the proper credentials
in the \$BINTRAY_USERNAME and \$BINTRAY_APIKEY environment variables."
          fi
          docker pull "$image"
          if [[ ! $? -eq 0 ]]; then
            docker logout $KONG_EE_REPO
            err "failed to pull: $image"
          fi
          msg "pull with login succeeded"
          docker logout $KONG_EE_REPO
        else
          # failed to pull CE image, so try the fallback
          # NOTE: new releases take a while (days) to become available in the
          # official docker hub repo. Hence we fall back on the unofficial Kong
          # repo that is immediately available for each release. This will
          # prevent any CI from failing in the mean time.
          msg "failed to pull: $image from the official repo, retrying unofficial..."
          image=$KONG_OSS_TAG_FALLBACK_PREFIX$KONG_VERSION$KONG_OSS_TAG_FALLBACK_POSTFIX
          docker pull "$image"
          if [[ ! $? -eq 0 ]]; then
            err "failed to pull: $image"
          fi
          msg "pulling unofficial image succeeded"
        fi
      fi
    fi
  fi

  KONG_IMAGE=$image
}


function get_license {
  # If $KONG_VERSION is recognized as an Enterprise version and no license data
  # has been set in $KONG_LICENSE_DATA yet, then it will log into Bintray and
  # get the required license.
  # Result: $KONG_LICENSE_DATA will be set if it is needed
  if is_enterprise "$KONG_VERSION"; then
    if [[ -z $KONG_LICENSE_DATA ]]; then
      # Enterprise version, but no license data available, try and get the license data
      if [[ "$BINTRAY_USERNAME" == "" ]]; then
        warn "BINTRAY_USERNAME is not set, might not be able to download the license!"
      fi
      if [[ "$BINTRAY_APIKEY" == "" ]]; then
        warn "BINTRAY_APIKEY is not set, might not be able to download the license!"
      fi
      if [[ "$BINTRAY_REPO" == "" ]]; then
        warn "BINTRAY_REPO is not set, might not be able to download the license!"
      fi
      KONG_LICENSE_DATA=$(curl -s -L -u"$BINTRAY_USERNAME:$BINTRAY_APIKEY" "https://kong.bintray.com/$BINTRAY_REPO/license.json")
      export KONG_LICENSE_DATA
      if [[ ! $KONG_LICENSE_DATA == *"signature"* || ! $KONG_LICENSE_DATA == *"payload"* ]]; then
        # the check above is a bit lame, but the best we can do without requiring
        # yet more additional dependenies like jq or similar.
        warn "failed to download the Kong Enterprise license file!
          $KONG_LICENSE_DATA"
      fi
    fi
  fi
}


function get_version {
  # if $KONG_IMAGE is not yet set, it will get the image (see get_image).
  # Then it will read the Kong version from the image (by executing "kong version")
  #
  # Result: $VERSION will be read from the image, and $KONG_TEST_IMAGE will be set.
  # NOTE1: $KONG_TEST_IMAGE is only a name, the image might not have been created yet
  # NOTE2: if it is a nightly, then $VERSION will be a commit-id
  if [[ -z $KONG_IMAGE ]]; then
    if [[ -z $KONG_VERSION ]]; then
      KONG_VERSION=$KONG_DEFAULT_VERSION
    fi
    validate_version "$KONG_VERSION"
    get_image
  fi

  get_license

  if is_nightly "$KONG_VERSION"; then
    # it's a nightly; get the commit-id from the image
    VERSION=$(docker inspect \
       --format "{{ index .Config.Labels \"org.opencontainers.image.revision\"}}" \
       "$KONG_IMAGE")
    if [[ ! $? -eq 0 ]]; then
      err "failed to read commit-id from Kong image: $KONG_IMAGE, label: org.opencontainers.image.revision"
    fi
    if [[ "$VERSION" == "" ]]; then
      err "Got an empty commit-id from Kong image: $KONG_IMAGE, label: org.opencontainers.image.revision"
    fi

  else
    # regular Kong version, so extract the Kong version number
    local cmd=(
      '/bin/sh' '-c' '/usr/local/openresty/luajit/bin/luajit -e "
        local command = [[kong version]]
        local version_output = io.popen(command):read()

        local version_pattern = [[([%d%.%-]+)]]
        local parsed_version = version_output:match(version_pattern)

        io.stdout:write(parsed_version)
      "')
    VERSION=$(docker run --rm -e KONG_LICENSE_DATA "$KONG_IMAGE" "${cmd[@]}")
    if [[ ! $? -eq 0 ]]; then
      err "failed to read version from Kong image: $KONG_IMAGE"
    fi
  fi

  KONG_TEST_IMAGE=$IMAGE_BASE_NAME:$VERSION
}


function compose {
  export NETWORK_NAME
  export SERVICE_NETWORK_NAME
  export KONG_TEST_IMAGE
  export PONGO_WD
  # shellcheck disable=SC2086  # we need DOCKER_COMPOSE_FILES to be word-split here
  docker-compose -p "${PROJECT_NAME}" ${DOCKER_COMPOSE_FILES} "$@"
}


function healthy {
  local iid=$1
  [[ -z $iid ]] && return 1
  local state
  state=$(docker inspect "$iid")

  echo "$state" | grep \"Health\" &> /dev/null
  if [[ ! $? -eq 0 ]]; then
    # no healthcheck defined, assume healthy
    return 0
  fi

  echo "$state" | grep \"healthy\" &> /dev/null
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
  local dependency
  for dependency in ${KONG_DEPS_START[*]}; do
    healthy "$(cid "$dependency")" || compose up -d "$dependency"
  done;
}


function ensure_available {
  compose ps | grep "Up (health" &> /dev/null
  if [[ ! $? -eq 0 ]]; then
    msg "auto-starting the test environment, use the 'pongo down' action to stop it"
    compose_up
  fi

  local dependency
  for dependency in ${KONG_DEPS_START[*]}; do
    wait_for_dependency "$dependency"
  done;
}


function build_image {
  # if $KONG_TEST_IMAGE doesn't exist yet (or if forced), it will build that
  # image. This essentially comes down to:
  # 1. take $KONG_IMAGE as base image
  # 2. inject dev files based on $VERSION
  # 3. do a 'make dev' and then some (see the Dockerfile)
  # 4. Tag the result as $KONG_TEST_IMAGE
  get_version
  if is_nightly "$KONG_VERSION"; then
    # in a nightly then $VERSION is a commit id
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

  if is_nightly "$KONG_VERSION"; then
    # nightly; we must fetch the related development files dynamically in this case
    # shellcheck disable=SC1090  # do not follow source
    source "${LOCAL_PATH}/assets/update_versions.sh"
    update_nightly "$KONG_VERSION" "$VERSION"
  fi

  msg "starting build of image '$KONG_TEST_IMAGE'"
  docker build \
    -f "$DOCKER_FILE" \
    --build-arg KONG_BASE="$KONG_IMAGE" \
    --build-arg KONG_DEV_FILES="./kong-versions/$VERSION/kong" \
    --tag "$KONG_TEST_IMAGE" \
    "$LOCAL_PATH" || err "Error: failed to build test environment"

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


function pongo_clean {
  compose down --remove-orphans

  docker images --filter=reference="${IMAGE_BASE_NAME}:*" --format "found: {{.ID}}" | grep found
  if [[ $? -eq 0 ]]; then
    # shellcheck disable=SC2046  # we want the image ids to be word-splitted
    docker rmi $(docker images --filter=reference="${IMAGE_BASE_NAME}:*" --format "{{.ID}}")
  fi

  docker images --filter=reference="pongo-expose:*" --format "found: {{.ID}}" | grep found
  if [[ $? -eq 0 ]]; then
    # shellcheck disable=SC2046  # we want the image ids to be word-splitted
    docker rmi $(docker images --filter=reference="pongo-expose:*" --format "{{.ID}}")
  fi

  if [ -d "$LOCAL_PATH/kong" ]; then
    rm -rf "$LOCAL_PATH/kong"
  fi
  if [ -d "$LOCAL_PATH/kong-ee" ]; then
    rm -rf "$LOCAL_PATH/kong-ee"
  fi
}


function pongo_expose {
  local dependency="expose"
  healthy "$(cid "$dependency")" || compose up -d "$dependency"
  wait_for_dependency "$dependency"
}


function pongo_status {
  if [ ${#EXTRA_ARGS[@]} -eq 0 ]; then
    # default; do all
    EXTRA_ARGS=(networks dependencies containers images versions)
  fi

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
        docker network ls | grep "${PROJECT_NAME}"
        ;;

      dependencies)
        echo Pongo available dependencies:
        echo =============================
        local dep_name
        for dep_name in ${KONG_DEPS_AVAILABLE[*]}; do
          if array_contains KONG_DEPS_CUSTOM "$dep_name"; then
            echo "$dep_name (custom to local plugin)"
          else
            echo "$dep_name"
          fi
        done;
        ;;

      containers)
        echo Pongo dependency containers:
        echo ============================
        docker ps | grep "${PROJECT_NAME}"
        ;;

      images)
        echo Pongo cached images:
        echo ====================
        docker images "${PROJECT_NAME}*"
        ;;

      versions)
        echo Available Kong versions:
        echo ========================
        echo Kong: "${KONG_CE_VERSIONS[*]}" "$NIGHTLY_CE"
        echo Kong Enterprise: "${KONG_EE_VERSIONS[*]}" "$NIGHTLY_EE"
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
    for dep_name in ${KONG_DEPS_AVAILABLE[*]}; do
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
    compose down --remove-orphans
    ;;

  restart)
    compose down --remove-orphans
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
    check_docker
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

    compose run --rm \
      -e KONG_LICENSE_DATA \
      -e KONG_TEST_DONT_CLEAN \
      kong \
      "/bin/sh" "-c" "bin/busted --helper=bin/busted_helper.lua ${busted_params[*]} ${busted_files[*]}"
    ;;

  shell)
    check_docker
    get_plugin_names
    get_version
    docker inspect --type=image "$KONG_TEST_IMAGE" &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "image '$KONG_TEST_IMAGE' not found, auto-building it"
      build_image
    fi

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
      # no args, so plain shell
      exec_cmd="sh"
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
      exec_cmd="sh /kong/bin/shell_script.sh"
    fi

    # shellcheck disable=SC2086 # we explicitly want script_mount & exec_cmd to be splitted
    compose run --rm --use-aliases \
      -e KONG_LICENSE_DATA \
      -e KONG_LOG_LEVEL \
      -e KONG_ANONYMOUS_REPORTS \
      -e "SUPPRESS_KONG_VERSION=$suppress_kong_version" \
      -e "KONG_PG_DATABASE=kong_tests" \
      -e "KONG_PLUGINS=$PLUGINS" \
      -e "KONG_CUSTOM_PLUGINS=$CUSTOM_PLUGINS" \
      $script_mount \
      -e "PS1=\[\e[00m\]\[\033[1;34m\][$shellprompt:\[\033[1;92m\]\w\[\033[1;34m\]]#\[\033[00m\] " \
      kong $exec_cmd

    local result=$?

    if [[ "$cleanup" == "true" ]]; then
      rm -rf "./servroot"
    fi

    exit $result
    ;;

  lint)
    check_docker
    get_plugin_names
    get_version
    docker inspect --type=image "$KONG_TEST_IMAGE" &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "image '$KONG_TEST_IMAGE' not found, auto-building it"
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
    check_docker
    get_plugin_names
    get_version
    docker inspect --type=image "$KONG_TEST_IMAGE" &> /dev/null
    if [[ ! $? -eq 0 ]]; then
      msg "image '$KONG_TEST_IMAGE' not found, auto-building it"
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

  *)
    usage
    ;;
  esac
}


check_tools
globals
main "$@"
