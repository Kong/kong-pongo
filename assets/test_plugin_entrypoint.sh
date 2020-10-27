#!/bin/sh


# USAGE: do not use this file directly. It is the entry script for the
# test container, it will be injected when the container is build.
# there is no use in manually running this script.



# if we have preferences for busted set, move them to /kong
# such that busted will pick them up automagically
if [ -f /kong-plugin/.busted ]; then
  cp /kong-plugin/.busted /kong/
fi


if [ -z "$KONG_ADMIN_LISTEN" ]; then
  # admin_api is by default not exposed, other than 127.0.0.1, since different
  # Kong versions have different settings, find the default and replace it.
  FILE_WITH_KONG_DEFAULTS=$(luarocks show kong | grep -oEi '/.*/kong_defaults.lua')
  DEFAULT_ADMIN_LISTEN_SETTING=$(grep admin_listen < "$FILE_WITH_KONG_DEFAULTS" | sed 's/admin_listen *= *//')

  # export to override defaults in file, with 0.0.0.0 instead of 127.0.0.1
  export KONG_ADMIN_LISTEN
  KONG_ADMIN_LISTEN=$(echo "$DEFAULT_ADMIN_LISTEN_SETTING" | sed 's/127\.0\.0\.1/0.0.0.0/g')

  unset FILE_WITH_KONG_DEFAULTS
  unset DEFAULT_ADMIN_LISTEN_SETTING
fi


# add the plugin code to the LUA_PATH such that the plugin will be found
export "LUA_PATH=/kong-plugin/?.lua;/kong-plugin/?/init.lua;;"

# DNS resolution on docker always has this ip. Since we have a qualified
# name for the db server, we need to set up the DNS resolver, is set
# to 8.8.8.8 on the spec conf
export KONG_DNS_RESOLVER=127.0.0.11

# set working dir in mounted volume to be able to check the logs
export KONG_PREFIX=/kong-plugin/servroot

# set debug logs; specifically for the 'shell' command, tests already have it
export KONG_LOG_LEVEL=debug

# export Pongo's redis instance to the Kong test-helpers
export KONG_SPEC_REDIS_HOST=redis

# set the certificate store
export KONG_LUA_SSL_TRUSTED_CERTIFICATE=/etc/ssl/certs/ca-certificates.crt

# export the KONG_ variables also in the KONG_TEST_ range
if [ -z "$KONG_TEST_LICENSE_DATA" ]; then
  export "KONG_TEST_LICENSE_DATA=$KONG_LICENSE_DATA"
fi

if [ -z "$KONG_TEST_PG_HOST" ]; then
  export "KONG_TEST_PG_HOST=$KONG_PG_HOST"
fi

if [ -z "$KONG_TEST_CASSANDRA_CONTACT_POINTS" ]; then
  export "KONG_TEST_CASSANDRA_CONTACT_POINTS=$KONG_CASSANDRA_CONTACT_POINTS"
fi

if [ -z "$KONG_TEST_PREFIX" ]; then
  export "KONG_TEST_PREFIX=$KONG_PREFIX"
fi

if [ -z "$KONG_TEST_DNS_RESOLVER" ]; then
  export "KONG_TEST_DNS_RESOLVER=$KONG_DNS_RESOLVER"
fi

if [ -z "$KONG_TEST_LUA_SSL_TRUSTED_CERTIFICATE" ]; then
  export "KONG_TEST_LUA_SSL_TRUSTED_CERTIFICATE=$KONG_LUA_SSL_TRUSTED_CERTIFICATE"
fi



# perform any custom setup if specified
if [ -f /kong-plugin/.pongo/pongo-setup.sh ]; then
  pongo_setup=/kong-plugin/.pongo/pongo-setup.sh
elif [ -f /kong-plugin/.pongo-setup.sh ]; then
  # for backward compatibility
  pongo_setup=/kong-plugin/.pongo-setup.sh
else
  pongo_setup=none
fi
if [ "$pongo_setup" = "none" ]; then
  # if there is a rockspec, then install it first, so we get any required
  # dependencies installed before testing
  find /kong-plugin -maxdepth 1 -type f -name '*.rockspec' -exec luarocks install --only-deps {} \;
else
  old_entry_pwd=$(pwd)
  cd /kong-plugin || { echo "Failure to enter /kong-plugin"; exit 1; }
  # shellcheck source=/dev/null  # not checking this since it is user provided
  . $pongo_setup
  cd "$old_entry_pwd" || { echo "Failure to enter $old_entry_pwd"; exit 1; }
  unset old_entry_pwd
fi
unset pongo_setup


if [ ! "$SUPPRESS_KONG_VERSION" = "true" ]; then
  echo "Kong version: $(kong version)"
fi

exec "$@"
