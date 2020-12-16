ARG KONG_BASE
FROM ${KONG_BASE}


# add dev files
ARG KONG_DEV_FILES
COPY $KONG_DEV_FILES /kong

# add helper files to workaround some issues
COPY assets/busted_helper.lua /kong/bin

# add new entrypoint for plugin testing
COPY assets/test_plugin_entrypoint.sh /kong/bin/test_plugin_entrypoint.sh

# add packer script
COPY assets/pongo_pack /kong/bin/pongo_pack

USER root
# httpie and jq are genric utilities usable from the shell action.
# LuaRocks needs (un)zip to (un)pack rocks, and dev essentials to build.
# Setup the developemnt dependencies using the make target
# and make the entrypoint executable
#
# Note: 'openssl-dev' (and m4, bsd-headers) is added to build the 'cqueue' rock.
# It provides the headers in the system location for 'make dependencies' to succeed.
# The proper thing to do would be the included ones by specifying them like so:
#   CRYPTO_DIR=/usr/local/kong \
#   OPENSSL_DIR=/usr/local/kong \
#   make dependencies
# But that means hardcoding and that doesn't play well with the nature of Pongo
# that should be independent of Kong versions.
RUN apk update \
    && apk add zip unzip make g++ py-pip jq git bsd-compat-headers m4 openssl-dev curl \
    && curl -s -S -L https://github.com/fullstorydev/grpcurl/releases/download/v1.7.0/grpcurl_1.7.0_linux_x86_64.tar.gz | tar xz -C /kong/bin \
    && pip install 'httpie<2.0.0'\
    && cd /kong \
    && make dependencies \
    && luarocks install busted-htest \
    && chmod +x /kong/bin/test_plugin_entrypoint.sh


# make sure resty, LuaJIT, and our custom Busted are in our path
ENV PATH="/kong/bin:/usr/local/openresty/bin:/usr/local/openresty/luajit/bin:${PATH}"


WORKDIR /kong
ENTRYPOINT ["/kong/bin/test_plugin_entrypoint.sh"]
