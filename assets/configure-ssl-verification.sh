#!/bin/bash

# Switches TLS verification off for curl and git during the image build, when
# $PONGO_INSECURE is set to anything other than "false". Useful behind a proxy
# whose certificate is not available; see 'pongo build --help'.
#
# The later "restore the insecure settings from above to secure" layer in the
# Dockerfile undoes this, so it applies to the build only.
#
# This lives in a script rather than inline in the Dockerfile so that its
# behaviour can be tested directly; see assets/ci/pongo_insecure.test.sh.

set -e

if [ -n "$PONGO_INSECURE" ] && [ "$PONGO_INSECURE" != "false" ]; then
  echo "Configuring curl and git to switch off ssl-verification"
  echo '--insecure' >> ~/.curlrc
  git config --global http.sslVerify false
fi
