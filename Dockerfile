ARG KONG_BASE
FROM ${KONG_BASE}


# add dev files
ARG KONG_DEV_FILES
COPY $KONG_DEV_FILES /kong


# add new entrypoint for plugin testing
COPY test_plugin_entrypoint.sh /kong/bin/test_plugin_entrypoint.sh

USER root
# httpie and jq are genric utilities usable from the shell action.
# LuaRocks needs unzip to unpack rocks, and dev essentials to build.
# Setup the developemnt dependencies using the make target
# and make the entrypoint executable
RUN apk update \
    && apk add unzip make g++ py-pip jq git \
    && pip install httpie \
    && cd /kong \
    && make dependencies \
    && chmod +x /kong/bin/test_plugin_entrypoint.sh


# make sure OpenResty cmdline 'resty' is in our path, and our busted version
ENV PATH="/kong/bin:/usr/local/openresty/bin:${PATH}"


WORKDIR /kong
ENTRYPOINT ["/kong/bin/test_plugin_entrypoint.sh"]
