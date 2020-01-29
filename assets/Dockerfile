ARG KONG_BASE
FROM ${KONG_BASE}


# add dev files
ARG KONG_DEV_FILES
COPY $KONG_DEV_FILES /kong

# add helper files to workaround some issues
COPY assets/busted_helper.lua /kong/bin

# add new entrypoint for plugin testing
COPY assets/test_plugin_entrypoint.sh /kong/bin/test_plugin_entrypoint.sh

USER root
# httpie and jq are genric utilities usable from the shell action.
# LuaRocks needs unzip to unpack rocks, and dev essentials to build.
# Setup the developemnt dependencies using the make target
# and make the entrypoint executable
#
# Note: 'openssl-dev' is added to build the 'cqueue' rock. It provides the
# headers in the system location for 'make dependencies' to succeed. The
# proper thing to do would be the included ones by specifying them like so:
#   CRYPTO_DIR=/usr/local/kong \
#   OPENSSL_DIR=/usr/local/kong \
#   make dependencies
# But that means hardcoding and that doesn't play well with the nature of Pongo
# that should be independent of Kong versions.
RUN apk update \
    && apk add unzip make g++ py-pip jq git bsd-compat-headers m4 openssl-dev \
    && pip install httpie \
    && cd /kong \
    && make dependencies \
    && chmod +x /kong/bin/test_plugin_entrypoint.sh


# make sure OpenResty cmdline 'resty' is in our path, and our busted version
ENV PATH="/kong/bin:/usr/local/openresty/bin:${PATH}"


WORKDIR /kong
ENTRYPOINT ["/kong/bin/test_plugin_entrypoint.sh"]
