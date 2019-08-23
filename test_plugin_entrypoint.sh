#!/bin/sh

# if we have preferences for busted set, move them to /kong
# such that busted will pick them up automagically
if [ -f /kong-plugin/.busted ]; then
  cp /kong-plugin/.busted /kong/
fi

# add the plugin code to the LUA_PATH such that the plugin will be found
export "LUA_PATH=/kong-plugin/?.lua;/kong-plugin/?/init.lua;;"

# export the KONG_ variables also in the KONG_TEST_ range
export "KONG_TEST_LICENSE_DATA=$KONG_LICENSE_DATA"
export "KONG_TEST_PG_HOST=$KONG_PG_HOST"
export "KONG_TEST_CASSANDRA_CONTACT_POINTS=$KONG_CASSANDRA_CONTACT_POINTS"

exec "$@"
