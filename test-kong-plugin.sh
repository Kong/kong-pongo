#!/bin/bash

IMAGE_BASE_NAME=kong_plugin_tester
DEFAULT_IMAGE="kong-ee"
KONG_IMAGE=${KONG_IMAGE-$DEFAULT_IMAGE}



# Locate our script directory containing the dev files
MY_HOME="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"



# detect what version of Kong is in the base image
VERSION=$(docker run -it --rm \
    -e "KONG_LICENSE_DATA=$KONG_LICENSE_DATA" \
    $KONG_IMAGE \
    /bin/sh -c "/usr/local/openresty/luajit/bin/luajit -e \"io.stdout:write(io.popen([[kong version]]):read():match([[([%d%.%-]+)]]))\"" \
)

if [ ! $? -eq 0 ]; then
    echo "Error: could not get the Kong version from docker image '$KONG_IMAGE'."
    echo "You can specify the base image to use with the KONG_IMAGE env variable."
    exit 1
fi

if [ ! -d "$MY_HOME/kong-versions/$VERSION" ]; then
    echo "Error: no development package available for version '$VERSION'."
    exit 1
fi



# build the test image if we do not have it
docker inspect --type=image $IMAGE_BASE_NAME:$VERSION > /dev/null

if [ ! $? -eq 0 ]; then
    echo "Testing against Kong version '$VERSION', but test image not build yet, building now..."
    pushd "$MY_HOME"  > /dev/null
    docker build \
        --build-arg KONG_BASE="$KONG_IMAGE" \
        --build-arg KONG_DEV_FILES="./kong-versions/$VERSION/kong" \
        --tag "$IMAGE_BASE_NAME:$VERSION" .
    if [ ! $? -eq 0 ]; then
        echo "Error: failed to build test environment."
        exit 1
    fi
    popd  > /dev/null
fi



# Now here let's start the dependencies
NETWORK_NAME=kong-plugin-test-network
POSTGRES_NAME=kong-plugin-test-postgres
CASSANDRA_NAME=kong-plugin-test-cassandra

SLEEP=0

# set up docker network
NETWORK=UNAVAILABLE
docker network ls -q --filter "name=$NETWORK_NAME" | grep -q . && NETWORK=AVAILABLE
if [ "$NETWORK" == "UNAVAILABLE" ]; then
    echo Creating docker network
    docker network create $NETWORK_NAME
#else
#    echo Network already exists...
fi



# set up Postgres
POSTGRES=UNAVAILABLE
docker ps -q -a --filter "name=$POSTGRES_NAME" | grep -q . && POSTGRES=STOPPED
docker ps -q --filter "name=$POSTGRES_NAME" | grep -q . && POSTGRES=RUNNING

if [ ! "$POSTGRES" == "RUNNING" ]; then
    if [ "$POSTGRES" == "STOPPED" ]; then
        echo Postgres stopped, removing...
        docker rm $POSTGRES_NAME
    fi
    echo Creating postgres...
    docker run -d --name $POSTGRES_NAME \
               --network=$NETWORK_NAME \
               -p 5432:5432 \
               -e "POSTGRES_USER=kong" \
               -e "POSTGRES_DB=kong_tests" \
               postgres:9.6
    SLEEP=5
#else
#    echo Postgres already running...
fi



# set up Cassandra
CASSANDRA=UNAVAILABLE
docker ps -q -a --filter "name=$CASSANDRA_NAME" | grep -q . && CASSANDRA=STOPPED
docker ps -q --filter "name=$CASSANDRA_NAME" | grep -q . && CASSANDRA=RUNNING

if [ ! "$CASSANDRA" == "RUNNING" ]; then
    if [ "$CASSANDRA" == "STOPPED" ]; then
        echo Cassandra stopped, removing...
        docker rm $CASSANDRA_NAME
    fi
    echo Creating cassandra...
    docker run -d --name $CASSANDRA_NAME \
               --network=$NETWORK_NAME \
               -p 9042:9042 \
               cassandra:3
    SLEEP=5
#else
#    echo Cassandra already running...
fi



# if we started a database, let's wait for them to start up
sleep $SLEEP



# test from the plugin repo
docker run -it --rm \
    --network=$NETWORK_NAME \
    -v $(realpath ./):/kong-plugin \
    -e "KONG_LICENSE_DATA=$KONG_LICENSE_DATA" \
    -e "KONG_PG_HOST=$POSTGRES_NAME" \
    -e "KONG_CASSANDRA_CONTACT_POINTS=$CASSANDRA_NAME" \
    kong-plugin-test \
    /bin/sh -c "bin/busted -v -o gtest /kong-plugin/spec"
#    bin/busted -v -o gtest /kong-plugin/spec
#    --entrypoint "/bin/sh" \
#popd
