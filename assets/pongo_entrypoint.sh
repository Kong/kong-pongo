#!/bin/sh


# USAGE: do not use this file directly. It is the entry script for the
# test container, it will be injected when the container is build.
# there is no use in manually running this script.



# if we have preferences for busted set, move them to /kong
# such that busted will pick them up automagically
if [ -f /kong-plugin/.busted ]; then
  cp /kong-plugin/.busted /kong/
fi
# same for LuaCov
if [ -f /kong-plugin/.luacov ]; then
  cp /kong-plugin/.luacov /kong/
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

# many of the test config files for Kong will have a nameserver set to 8.8.8.8
# this will clearly not work with Docker, so we need to override it. Hence we
# parse the resolv.conf file (to get whatever Docker provided us) and set the
# value in KONG_DNS_RESOLVER.
if [ -z "$KONG_DNS_RESOLVER" ]; then
  export KONG_DNS_RESOLVER
  grep "nameserver " < /etc/resolv.conf | sed "s/nameserver //" | while read -r line ; do
    if [ -z "$KONG_DNS_RESOLVER" ]; then
      KONG_DNS_RESOLVER=$line
    else
      KONG_DNS_RESOLVER=$KONG_DNS_RESOLVER,$line
    fi
    echo "$KONG_DNS_RESOLVER" > /tmp/KONG_DNS_RESOLVER
  done
  if [ -f /tmp/KONG_DNS_RESOLVER ]; then
    KONG_DNS_RESOLVER=$(cat /tmp/KONG_DNS_RESOLVER)
    rm /tmp/KONG_DNS_RESOLVER
  else
    # we didn't get any, so set the standard Docker nameserver address
    KONG_DNS_RESOLVER="127.0.0.1"
  fi
fi

# set working dir in mounted volume to be able to check the logs
export KONG_PREFIX=/kong-plugin/servroot

# set debug logs; specifically for the 'shell' command, tests already have it
export KONG_LOG_LEVEL=debug

# export Pongo's redis instance to the Kong test-helpers
export KONG_SPEC_REDIS_HOST=redis
# Kong test-helpers 3.0.0+
export KONG_SPEC_TEST_REDIS_HOST=redis
# Support Redis Cluster (RC)
export KONG_SPEC_TEST_REDIS_CLUSTER_ADDRESSES="rc:7000,rc:7001,rc:7003"

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


# Modify the 'kong' user to match the ownership of the mounted plugin folder
# Kong will not start because of permission errors if it cannot write to the
# /kong-plugin/servroot folder (which resides on the mount).
# Since those permissions are controlled by the host, we update the 'kong' user
# inside the container to match the UID and GID.
if [ -d /kong-plugin ]; then
  KONG_UID=$(id -u kong)
  KONG_GID=$(id -g kong)
  MOUNT_UID=$(stat -c "%u" /kong-plugin)
  MOUNT_GID=$(stat -c "%g" /kong-plugin)
  if [ ! "$KONG_GID" = "$MOUNT_GID" ]; then
    # change KONG_GID to the ID of the folder owner group
    groupmod -g "$MOUNT_GID" --non-unique kong
  fi

  if [ ! "$KONG_UID" = "$MOUNT_UID" ]; then
    # change KONG_UID to the ID of the folder owner
    usermod -u "$MOUNT_UID" -g "$MOUNT_GID" --non-unique kong
  fi
  unset KONG_UID
  unset KONG_GID
  unset MOUNT_UID
  unset MOUNT_GID
fi


# perform any custom setup if specified
if [ -f /kong-plugin/.pongo/pongo-setup.sh ]; then
  pongo_setup=/kong-plugin/.pongo/pongo-setup.sh
elif [ -f /kong-plugin/.pongo-setup.sh ]; then
  # for backward compatibility
  pongo_setup=/kong-plugin/.pongo-setup.sh
else
  # fallback to default setup
  pongo_setup=/pongo/default-pongo-setup.sh
fi

if [ -d /kong-plugin ]; then
  old_entry_pwd=$(pwd)
  cd /kong-plugin || { echo "Failure to enter /kong-plugin"; exit 1; }
  # shellcheck source=/dev/null  # not checking this since it is user provided
  . $pongo_setup
  cd "$old_entry_pwd" || { echo "Failure to enter $old_entry_pwd"; exit 1; }
  unset old_entry_pwd
  unset pongo_setup
fi

if [ ! "$SUPPRESS_KONG_VERSION" = "true" ]; then
  echo "Kong version: $(kong version)"
fi

exec "$@"
