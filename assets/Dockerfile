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

RUN apt update \
    && apt install -y zip make m4 jq curl build-essential wget git zlib1g-dev lsb-release
RUN /pongo/install-python.sh
RUN pip3 install httpie
RUN curl -k -s -S -L https://github.com/fullstorydev/grpcurl/releases/download/v1.7.0/grpcurl_1.7.0_linux_x86_64.tar.gz | tar xz -C /kong/bin
RUN cd /kong \
    && git config --global url.https://github.com/.insteadOf git://github.com/ \
    && export KONG_PREFIX=${KONG_PREFIX:-/usr/local/kong} \
    && make dependencies CRYPTO_DIR=$KONG_PREFIX \
                         OPENSSL_DIR=$KONG_PREFIX \
    && luarocks install busted-htest \
    && luarocks install luacov


# make sure resty, LuaJIT, and our custom Busted are in our path
ENV PATH="/kong/bin:/usr/local/openresty/bin:/usr/local/openresty/luajit/bin:${PATH}"


WORKDIR /kong
ENTRYPOINT ["/pongo/pongo_entrypoint.sh"]
