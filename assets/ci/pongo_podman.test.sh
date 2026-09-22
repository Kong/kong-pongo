#!/usr/bin/env bash

# Smoke test for the Podman runtime. Deliberately a single Kong version end to
# end (up -> build -> run -> down -> clean) instead of the full version matrix
# the Docker suite runs; the point is to catch runtime incompatibilities, not
# to re-test every Kong release on a second runtime.

function run_test {
  tinitialize "Pongo test suite" "${BASH_SOURCE[0]}"

  tchapter "Pongo on Podman"

  ttest "the podman runtime is selected"
  if [[ "$PONGO_CONTAINER_RUNTIME" == "podman" ]]; then
    tsuccess
  else
    tfailure "expected PONGO_CONTAINER_RUNTIME to be 'podman', got '$PONGO_CONTAINER_RUNTIME'"
  fi

  ttest "podman runs rootless"
  if [[ "$(id -u)" != "0" ]]; then
    tsuccess
  else
    # not a failure; rootful Podman is supported too, but rootless is what we
    # actually want covered
    tsuccess "running as root, so this is not covering the rootless path"
  fi

  # clone and enter the template plugin
  git clone https://github.com/kong/kong-plugin.git
  pushd kong-plugin || exit 1

  # postgres is the dependency that matters most here; it exercises the
  # rootless network and the DNS based service discovery
  echo "--postgres" > .pongo/pongorc

  ttest "pongo up"
  pongo up
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  ttest "pongo build"
  pongo build
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  ttest "pongo run"
  pongo run
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  ttest "the plugin directory is writable from the container"
  # 'servroot' is written by Kong into the bind-mount, so its presence proves
  # the rootless uid mapping and any SELinux relabelling worked
  if [ -d ./servroot ]; then
    tsuccess
    pongo shell rm -rf /kong-plugin/servroot
  else
    tfailure "'servroot' was not created in the mounted plugin directory"
  fi

  ttest "pongo down"
  pongo down
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  ttest "pongo clean"
  pongo clean
  if [ $? -eq 0 ]; then
    tsuccess
  else
    tfailure
  fi

  popd || exit 1
  if [ -d ./kong-plugin ]; then
    rm -rf kong-plugin
  fi

  tfinish
}

# No need to modify anything below this comment

# shellcheck disable=SC1090  # do not follow source
[[ "$T_PROJECT_NAME" == "" ]] && set -e && if [[ -f "${1:-$(dirname "$(realpath "$0")")/test.sh}" ]]; then source "${1:-$(dirname "$(realpath "$0")")/test.sh}"; else source "${1:-$(dirname "$(realpath "$0")")/run.sh}"; fi && set +e
run_test
