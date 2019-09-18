#!/bin/bash

# List of supported Kong versions, last one will be used as default
KONG_EE_VERSIONS="0.33 0.33-1 0.33-2 0.34 0.34-1 0.35 0.35-1 0.35-3 0.35-4 0.36-1 0.36-2"
# 0.36 is not supported because LuaRocks was borked in that version


# loop over and keep the last one as the default
for VERSION in $KONG_EE_VERSIONS ; do
    KONG_EE_DEFAULT_VERSION="$VERSION"
done;
