ARG KONG_BASE=kong-ee:latest
FROM ${KONG_BASE}

# LuaRocks needs unzip to unpack rocks
RUN  apk add unzip

# dev essentials
RUN  apk add make
RUN  apk add g++

# add dev files
ARG KONG_DEV_FILES
ENV KONG_DEV_FILES=${KONG_DEV_FILES}
COPY $KONG_DEV_FILES /kong

# setup the developemnt dependencies using the make target
RUN cd /kong && make dependencies

# make sure OpenResty cmdline 'resty' is in our path
ENV PATH="/usr/local/openresty/bin:${PATH}"

# add our kong specific busted version to the path
ENV PATH="/kong/bin:${PATH}"

# add new entrypoint for plugin testing
COPY test_plugin_entrypoint.sh /kong/bin/test_plugin_entrypoint.sh
RUN ["/bin/chmod", "+x", "/kong/bin/test_plugin_entrypoint.sh"]
ENTRYPOINT ["/kong/bin/test_plugin_entrypoint.sh"]

WORKDIR /kong

