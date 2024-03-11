ARG KONG_BASE
FROM ${KONG_BASE}

# add dev files
ARG KONG_DEV_FILES
COPY $KONG_DEV_FILES /kong

ARG PONGO_VERSION
ENV PONGO_VERSION=$PONGO_VERSION

# add helper files to workaround some issues
COPY assets/busted_helper.lua        /pongo/busted_helper.lua
COPY assets/pongo_entrypoint.sh      /pongo/pongo_entrypoint.sh
COPY assets/default-pongo-setup.sh   /pongo/default-pongo-setup.sh
COPY assets/pongo_pack.lua           /pongo/pongo_pack.lua
COPY assets/kong_migrations_start.sh /pongo/kong_migrations_start.sh
COPY assets/kong_start_dbless.sh     /pongo/kong_start_dbless.sh
COPY assets/kong_export.sh           /pongo/kong_export.sh
COPY assets/kong_setup_auth.sh       /pongo/kong_setup_auth.sh
COPY assets/parse_git_branch.sh      /pongo/parse_git_branch.sh
COPY assets/pongo_logo.sh            /pongo/pongo_logo.sh
COPY assets/workspace_update.lua     /pongo/workspace_update.lua
COPY assets/pongo_profile.sh         /etc/profile.d/pongo_profile.sh
COPY assets/install-python.sh        /pongo/install-python.sh

USER root
# httpie and jq are genric utilities usable from the shell action.
# LuaRocks needs (un)zip to (un)pack rocks, and dev essentials to build.
# Setup the development dependencies using the make target
# and make the entrypoint executable

ARG KONG_LIBRARY_PREFIX=/usr/local/kong
ENV KONG_LIBRARY_PREFIX $KONG_LIBRARY_PREFIX

ENV LUAROCKS_CRYPTO_DIR=$KONG_LIBRARY_PREFIX
ENV LUAROCKS_OPENSSL_DIR=$KONG_LIBRARY_PREFIX

ENV LUAROCKS_OPTS="CRYPTO_DIR=$LUAROCKS_CRYPTO_DIR OPENSSL_DIR=$LUAROCKS_OPENSSL_DIR"

ARG http_proxy
ARG https_proxy
ARG no_proxy
ARG ftp_proxy
ARG PONGO_INSECURE

# psmisc: provides `fuser`
# net-tools: provides `netstat`

RUN apt update \
    && apt install -y zip make jq m4 curl build-essential wget git libssl-dev zlib1g-dev lsb-release psmisc net-tools

# insecure connections can be useful if the certs for any intermediate proxy are unavailable
RUN if [ -n "$PONGO_INSECURE" ] || [ "$PONGO_INSECURE" != "false" ]; then \
        echo "Configuring curl and git to switch off ssl-verification"; \
        echo '--insecure' >> ~/.curlrc; \
        git config --global http.sslVerify false; \
    fi

RUN /pongo/install-python.sh
RUN pip3 install httpie || echo -e "\n\n\nFailed installing httpie, continuing without.\n\n\n"
RUN curl -s -S -L https://github.com/fullstorydev/grpcurl/releases/download/v1.7.0/grpcurl_1.7.0_linux_x86_64.tar.gz | tar xz -C /kong/bin
RUN cd /kong \
    && git config --global url.https://github.com/.insteadOf git://github.com/ \
    && make dependencies $LUAROCKS_OPTS \
    && luarocks install busted-htest \
    && luarocks install luacov \
    && luarocks install kong-plugin-dbless-reload 0.1.0

# restore the insecure settings from above to secure
RUN if [ -e ~/.bashrc ]; then rm ~/.bashrc; fi; \
    git config --global http.sslVerify true

# make sure resty, LuaJIT, and our custom Busted are in our path
ENV PATH="/kong/bin:/usr/local/openresty/bin:/usr/local/openresty/luajit/bin:${PATH}"


WORKDIR /kong
ENTRYPOINT ["/pongo/pongo_entrypoint.sh"]
