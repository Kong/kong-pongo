#!/bin/bash

# Installs grpcurl $GRPCURL_VERSION for the architecture being built for.
#
# This lives in a script instead of a Dockerfile 'RUN' heredoc because
# heredocs are BuildKit-only syntax, and Pongo also has to build with
# Buildah/Podman.

set -e

case "$(uname -m)" in
  x86_64|amd64)  grpcurl_machine="x86_64" ;;
  aarch64|arm64) grpcurl_machine="arm64" ;;
  *) echo "unsupported architecture for grpcurl: $(uname -m)" >&2; exit 1 ;;
esac

curl -s -S -L "https://github.com/fullstorydev/grpcurl/releases/download/v${GRPCURL_VERSION}/grpcurl_${GRPCURL_VERSION}_linux_${grpcurl_machine}.tar.gz" \
  | tar xz -C /kong/bin grpcurl
