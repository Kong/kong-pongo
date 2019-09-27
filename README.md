```
                /~\
  ______       C oo
  | ___ \      _( ^)
  | |_/ /__  _/__ ~\ __   ___
  |  __/ _ \| '_ \ / _` |/ _ \
  | | | (_) | | | | (_| | (_) |
  \_|  \___/|_| |_|\__, |\___/
                    __/ |
                   |___/

Usage: pongo action [options...]

Options:
  --cassandra           only use cassandra db
  --postgres            only use postgres db

Actions:
  up            start required database containers for testing

  build         build the Kong test image

  run           run spec files, accepts Busted options and spec files/folders
                as arguments, see: 'pongo run -- --help'

  shell         get a shell directly on a kong container

  down          remove all containers

Environment variables:
  KONG_VERSION  the specific Kong version to use when building the test image

  KONG_IMAGE    the base Kong Docker image to use when building the test image

  KONG_LICENSE_DATA
                set this variable with the Kong Enterprise license data

Example usage:
  pongo run
  KONG_VERSION=0.36-1 pongo run -v -o gtest ./spec/02-access_spec.lua
  KONG_IMAGE=kong-ee pongo run
  pongo down
```

# pongo
Pongo provides a simple way of testing Kong Enterprise plugins

## Requirements

Set up the following:

* Have the Kong Enterprise license key, and set it in `KONG_LICENSE_DATA`.
* Have a docker image of Kong Enterprise, and set the image name in the
  environment variable `KONG_IMAGE`, or alternatively log in to Bintray before
  running Pongo.

## Installation


> Note you need `~/.local/bin` on your `$PATH`.

* clone the repo and install Pongo:
    ```shell
    PATH=$PATH:~/.local/bin
    git clone git@github.com:Kong/kong-pongo.git
    mkdir -p ~/.local/bin
    ln -s $(realpath kong-pongo/pongo.sh) ~/.local/bin/pongo
    ```

## Do a test run

Get a shell into your plugin repository, and run `pongo`, for example:

```shell
git clone git@github.com:Kong/kong-plugin.git
cd kong-plugin

# auto pull and build the test images (log into bintray first!)
pongo run ./spec

# Run against a specific version of Kong (log into bintray first!) and pass
# a number of Busted options
KONG_VERSION=0.36-1 pongo run -v -o gtest ./spec

# Run against a local image of Kong
KONG_IMAGE=kong-ee pongo run ./spec
```

The above command (`pongo run`) will automatically build the test image and
start the test environment. When done, the test environment can be torn down by:

```shell
pongo down
```

## Debugging

When running the tests, the Kong prefix (or working directory) will be set to
`./servroot`.

So to track what is happening you can use a `tail` on `./servroot/logs/error.log`
like this:

```shell
tail -F ./servroot/logs/error.log
```

## How it works

The repo has 3 main components;

1. `pongo.sh`: This is the actual test script. It can be run from a
   plugin repo. It can build the test image and set up the datastores
   (postgres & cassandra). And then run the tests found in the repo.
   As a user, this is the only script you need.
2. docker-compose file: this has the dependencies (postgres and cassandra).
   there is no need to use docker-compose, it can be used transparently from
   Pongo.
3. `update_versions.sh`: This is a script that extracts the development files
   from the Kong-EE source repo and stores them in this repo. This script
   should only be updated (version list at the top), and run, after a new
   version of Kong-EE has been released. There is no need to use this script
   as a user of Pongo.

