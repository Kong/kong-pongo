#!/bin/bash

# Updates LuaRocks to $LUAROCKS_VERSION if the version in the base image is
# older than that.
#
# This lives in a script instead of a Dockerfile 'RUN' heredoc because
# heredocs are BuildKit-only syntax, and Pongo also has to build with
# Buildah/Podman.

set -e

# the version is passed in by the Dockerfile rather than inherited from the
# build environment, so the script is explicit about its inputs
LUAROCKS_VERSION="${1:?LUAROCKS_VERSION must be given as the first argument}"

build_version=$( luarocks --version | sed -nE '1s#/usr/local/bin/luarocks ([[:digit:].]+)$#\1#; s#\.##gp' )
luarocks_version=$( echo "$LUAROCKS_VERSION" | awk 'BEGIN { FS="." }; { printf("%d%d%d\n", $1,$2,$3) }' )

if [ "$build_version" -ge "$luarocks_version" ]; then
  # meets the minimum requirement, skip the update
  luarocks --version
  exit 0
fi
echo "Update luarocks to version $LUAROCKS_VERSION"

build_dir="/luarocks-build"
mkdir -p $build_dir && cd $build_dir
curl -LO "https://luarocks.org/manifests/hisham/luarocks-${LUAROCKS_VERSION}-1.src.rock"
luarocks install "luarocks-${LUAROCKS_VERSION}-1.src.rock"
luarocks --version

mkdir -p /usr/local/kong/temp
chown -R kong /usr/local/kong/temp
luarocks config home "/usr/local/kong/temp"

cd / && rm -rf $build_dir
