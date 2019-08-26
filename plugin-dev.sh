

# move to our script directory, to clone stuff only once
pushd "$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Step 1
#
# This part should become part of Kong distro's
# a few KB's with additional test files
#
if [ ! -d "./kong-ee" ]; then
  git clone https://github.com/kong/kong-ee.git
  pushd kong-ee
  git checkout 0.36-1

  cp ../Dockerfile-plugin-dev ./

  docker build \
     -f Dockerfile-plugin-dev \
     --tag "kong-plugin-dev" .

  popd
fi


# Step 2
#
# This is what a customer/developer would run to build a
# test image with all deps installed (basically "make dev")
#
# Tags should probably be Kong version specific
docker build \
   --build-arg KONG_BASE=kong-plugin-dev \
   --tag "kong-plugin-test" .

# done return to our old directory
popd


# Step 3
#
# Now here let's start the dependencies
# Most of this should probably be done through docker-compose/Gojira


echo #############################
echo        STARTING
echo #############################


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
else
    echo Postgres already running...
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
else
    echo Cassandra already running...
fi

# if we started a database, let's wait for them to start up
sleep $SLEEP


echo "#############################"
echo "   Let's run some tests!"
echo "#############################"


# Step 4
#
# Now here let's run the actual tests


# test from the plugin repo
#pushd ./kong-plugin
docker run -it --rm \
    --network=$NETWORK_NAME \
    -v $(realpath ./):/kong-plugin \
    -e "KONG_LICENSE_DATA=$KONG_LICENSE_DATA" \
    -e "KONG_PG_HOST=$POSTGRES_NAME" \
    -e "KONG_CASSANDRA_CONTACT_POINTS=$CASSANDRA_NAME" \
    kong-plugin-test \
    bin/busted -v -o gtest /kong-plugin/spec
#    --entrypoint "/bin/sh" \
#popd
