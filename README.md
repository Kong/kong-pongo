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

Usage: pongo.sh action [options...]

Options:
  --cassandra           only use cassandra db
  --postgres            only use postgres db

Actions:
  up            start required database containers for testing

  build         build the Kong test image

  run           run spec files, accepts spec files or folders as arguments

  shell         get a shell directly on a kong container

  down          remove all containers

Example usage:
  KONG_IMAGE=kong-ee pongo.sh build
  KONG_IMAGE=kong-ee pongo.sh run
  pongo.sh down
```

# pongo
Pongo provides a simple way of testing Kong Enterprise plugins

## Requirements

Set up the following:

* Have a docker image of Kong Enterprise, and set the image name in the
  environment variable `KONG_IMAGE`.
* Have the Kong Enterprise license key, and set it in `KONG_LICENSE_DATA`.
* Build the test image. This needs to be done only once. To do so execute:
    ```shell
    KONG_IMAGE=<image-name> pongo build
    ```

## Do a test run

Get a shell into your plugin repository, and run the tests:

```shell
pongo run
```

The above command will automatically start the test environment. When done
the test environment can be torn down by:

```shell
pongo down
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

