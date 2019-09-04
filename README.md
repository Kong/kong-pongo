# kong-ee-plugin-test
experimental; EE images capable of running plugin tests


## requirements
Have a docker image of Kong Enterprise

## Do a test run
Example:

```shell
# clone this repo
git clone https://github.com/Kong/kong-ee-plugin-test.git

# clone a plugin repo
git clone https://github.com/Kong/kong-plugin-route-transformer.git

# set the docker image with Kong Enterprise to use
export KONG_IMAGE=kong-ee

# enter plugin directory and run the tests
cd kong-plugin-route-transformer
../kong-ee-plugin-test/test-kong-plugin.sh

# first time is slow because the image is being build, try it again
../kong-ee-plugin-test/test-kong-plugin.sh

```

## How it works

The repo has 2 main scripts;

1. `update_versions.sh`: This is a script that extracts the development files
   from the Kong-EE source repo and stores them in this repo. This script
   should only be updated (version list at the top), and run, after a new
   version of Kong-EE has been released.
2. `test-kong-plugin.sh`: This is the actual test script. It can be run from a
   plugin repo. It will build the test image (once) and set up the datastores
   (postgres & cassandra). And then run the tests found in the repo.


## Configuration

The only configuration is the name of the Kong docker image to use. This can be
set in the `KONG_IMAGE` environment variable. The test script will detect the
Kong version from this image and build the corresponding Kong test image on the
first run.

Other typical stuff does apply, so you also need the `KONG_LICENSE_DATA`
environment variable for example.
