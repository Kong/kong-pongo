ARG KONG_BASE
FROM ${KONG_BASE}


# add dev files
ARG KONG_DEV_FILES
COPY $KONG_DEV_FILES /kong

# add helper files to workaround some issues
COPY assets/busted_helper.lua        /pongo/busted_helper.lua
COPY assets/pongo_entrypoint.sh      /pongo/pongo_entrypoint.sh
COPY assets/default-pongo-setup.sh   /pongo/default-pongo-setup.sh
COPY assets/pongo_pack.lua           /pongo/pongo_pack.lua
COPY assets/kong_migrations_start.sh /pongo/kong_migrations_start.sh
COPY assets/kong_start_dbless.sh     /pongo/kong_start_dbless.sh
COPY assets/kong_export.sh           /pongo/kong_export.sh
COPY assets/parse_git_branch.sh      /pongo/parse_git_branch.sh
COPY assets/pongo_profile.sh         /etc/profile.d/pongo_profile.sh

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
    && apk add zip unzip make g++ py-pip jq git bsd-compat-headers m4 openssl-dev curl wget python3-dev nettle-dev curl-dev \
    && curl -k -s -S -L https://github.com/fullstorydev/grpcurl/releases/download/v1.7.0/grpcurl_1.7.0_linux_x86_64.tar.gz | tar xz -C /kong/bin \
    && pip install httpie \
    ; cd /kong \
    && git config --global url.https://github.com/.insteadOf git://github.com/ \
    && make dependencies \
    && luarocks install busted-htest \
    && luarocks install luacov


# make sure resty, LuaJIT, and our custom Busted are in our path
ENV PATH="/kong/bin:/usr/local/openresty/bin:/usr/local/openresty/luajit/bin:${PATH}"


WORKDIR /kong
ENTRYPOINT ["/pongo/pongo_entrypoint.sh"]
