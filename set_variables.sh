#!/bin/bash

# List of supported Kong versions, last one will be used as default
KONG_EE_VERSIONS="0.36 0.36-1 0.36-2"
# Pre 0.36 is not supported (make target 'dependencies' is missing)


# loop over and keep the last one as the default
for VERSION in $KONG_EE_VERSIONS ; do
    KONG_EE_DEFAULT_VERSION="$VERSION"
done;
