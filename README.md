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

Usage: pongo action [options...] [--] [action options...]

Options (can also be added to '.pongorc'):
  --no-cassandra     do not start cassandra db
  --no-postgres      do not start postgres db
  --redis            do start redis db (see readme for info)
  --squid            do start squid forward-proxy (see readme for info)

Project actions:
  lint          will run the LuaCheck linter
  
  pack          will pack all '*.rockspec' files into '*.rock' files for
                distribution (see LuaRocks package manager docs)

  run           run spec files, accepts Busted options and spec files/folders
                as arguments, see: '$(basename $0) run -- --help'

  shell         get a shell directly on a kong container

  tail          starts a tail on the specified file. Default file is
                ./servroot/logs/error.log, an alternate file can be specified

Environment actions:
  build         build the Kong test image, add '--force' to rebuild images

  clean / nuke  removes the dependency containers and deletes all test images

  down          remove all dependency containers

  restart       shortcut, a combination of; down + up

  status        show status of the Pongo network, images, and containers

  up            start required dependency containers for testing

Maintenance actions:
  update        update embedded artifacts for building test images


Environment variables:
  KONG_VERSION  the specific Kong version to use when building the test image
                (note that the patch-version can be 'x' to use latest)

  KONG_IMAGE    the base Kong Docker image to use when building the test image

  KONG_LICENSE_DATA
                set this variable with the Kong Enterprise license data

  POSTGRES      the version of the Postgres dependency to use (default 9.5)
  CASSANDRA     the version of the Cassandra dependency to use (default 3.9)
  REDIS         the version of the Redis dependency to use (default 5.0.4)

Example usage:
  pongo run
  KONG_VERSION=1.3.x pongo run -v -o gtest ./spec/02-access_spec.lua
  POSTGRES=9.4 KONG_IMAGE=kong-ee pongo run
  pongo down
```

# pongo

Pongo provides a simple way of testing Kong plugins

## Table of contents

 - [Requirements](#requirements)
 - [Installation](#installation)
 - [Do a test run](#do-a-test-run)
 - [Test dependencies](#test-dependencies)
    - Postgres (Kong datastore)
    - Cassandra (Kong datastore)
    - Redis (key-value store)
    - Squid (forward-proxy)
 - [Dependency defaults](#dependency-defaults)
 - [Debugging](#debugging)
 - [Test initialization](#test-initialization)
 - [Setting up CI](#setting-up-ci)
 - [Releasing new Kong versions](#releasing-new-kong-versions)


## Requirements

Set up the following when testing against Kong Enterprise:

* Have the Kong Enterprise license key, and set it in `KONG_LICENSE_DATA`.
* Set the Bintray credentials (for pulling Kong Enterprise images) in the
  environment variables `BINTRAY_USERNAME` and `BINTRAY_APIKEY`, or manually
  log in to the Kong docker repo.
* If you do not have Bintray credentials, make sure to have a docker image of
  Kong Enterprise, and set the image name in the environment variable `KONG_IMAGE`.

[Back to ToC](#table-of-contents)

## Installation

Clone the repository and install Pongo:
```shell
PATH=$PATH:~/.local/bin
git clone git@github.com:Kong/kong-pongo.git
mkdir -p ~/.local/bin
ln -s $(realpath kong-pongo/pongo.sh) ~/.local/bin/pongo
```

_Notes_: 
* you need `~/.local/bin` on your `$PATH`
* for MacOS you need the [`coreutils`](https://www.gnu.org/software/coreutils/coreutils.html)
  to be installed. This is easiest via the [Homebrew package manager](https://brew.sh/) by doing:
  ```
  brew install coreutils
  ```

[Back to ToC](#table-of-contents)

## Do a test run

Get a shell into your plugin repository, and run `pongo`, for example:

```shell
git clone git@github.com:Kong/kong-plugin.git
cd kong-plugin

# auto pull and build the test images
pongo run ./spec

# Run against a specific version of Kong (log into bintray first!) and pass
# a number of Busted options
KONG_VERSION=0.36-1 pongo run -v -o gtest ./spec

# Run against the latest patch version of a Kong release using '.x'
KONG_VERSION=1.2.x pongo run -v -o gtest ./spec

# Run against a local image of Kong
KONG_IMAGE=kong-ee pongo run ./spec
```

The above command (`pongo run`) will automatically build the test image and
start the test environment. When done, the test environment can be torn down by:

```shell
pongo down
```

[Back to ToC](#table-of-contents)

## Test dependencies

Pongo can use a set of test dependencies that can be used to test against. Each
can be enabled/disabled by respectively specifying `--[dependency_name]` or
`--no-[dependency-name]` as options for the `pongo up` and `pongo run`
commands. The alternate way of specifying the dependencies is
by adding them to the `.pongorc` file (see below).

The available dependencies are:

* **Postgres** Kong datastore (started by default)
  - Disable it with `--no-postgres`
  - The Postgres version is controlled by the `POSTGRES` environment variable

* **Cassandra** Kong datastore (started by default)
  - Disable it with `--no-cassandra`
  - The Cassandra version is controlled by the `CASSANDRA` environment variable

* **Redis** key-value store
  - Enable it with `--redis`
  - The Redis version is controlled by the `REDIS` environment variable
  - From within the environment the Redis instance is available at `redis:6379`,
    but from the test specs it should be accessed by using the `helpers.redis_host`
    field, and port `6379`, to keep it portable to other test environments. Example:
    ```shell
    local helpers = require "spec.helpers"
    local redis_host = helpers.redis_host
    local redis_port = 6379
    ```

* **Squid** (forward-proxy)
  - Enable it with `--squid`
  - The Squid version is controlled by the `SQUID` environment variable
  - From within the environment the Squid instance is available at `squid:3128`. 
    Essentially it would be configured as these standard environment variables:

    - `http_proxy=http://squid:3128/`
    - `https_proxy=http://squid:3128/`

    The configuration comes with basic-auth configuration, and a single user:

    - username: `kong`
    - password: `king`

    All access is to be authenticated by the proxy, except for the domain `.mockbin.org`,
    which is white-listed.

    Some test instructions to play with the proxy:
    ```shell
    # clean environment, start with squid and create a shell
    pongo down
    pongo up --squid --no-postgres --no-cassandra
    pongo shell

    # connect to httpbin (http), while authenticating
    http --proxy=http:http://kong:king@squid:3128 --proxy=https:http://kong:king@squid:3128 http://httpbin.org/anything

    # https also works
    http --proxy=http:http://kong:king@squid:3128 --proxy=https:http://kong:king@squid:3128 https://httpbin.org/anything

    # connect unauthenticated to the whitelisted mockbin.org (http)
    http --proxy=http:http://squid:3128 --proxy=https:http://squid:3128 http://mockbin.org/request

    # and here https also works
    http --proxy=http:http://squid:3128 --proxy=https:http://squid:3128 https://mockbin.org/request
    ```

[Back to ToC](#table-of-contents)

### Dependency defaults

The defaults do not make sense for every type of plugin and some dependencies
(Cassandra for example) can slow down the tests. So to override the defaults on
a per project/plugin basis, a `.pongorc` file can be added to the project.

The format of the file is very simple; each line contains 1 commandline option, eg.
a `.pongorc` file for a plugin that only needs Postgres and Redis:

  ```shell
  --no-cassandra
  --redis
  ```

[Back to ToC](#table-of-contents)

## Debugging

When running the tests, the Kong prefix (or working directory) will be set to
`./servroot`.

To track the error log (where any `print` or `ngx.log` statements will go) you
can use the tail command

```shell
pongo tail
```

The above would be identical to:

```shell
tail -F ./servroot/logs/error.log
```

[Back to ToC](#table-of-contents)

## Test initialization

By default when the test container is started, it will look for a `.rockspec`
file, if it finds one, then it will install that rockspec file with the
`--deps-only` flag. Meaning it will not install that rock itself, but if it
depends on any external libraries, those rocks will be installed.

For example; the Kong plugin `session` relies on the `lua-resty-session` rock.
So by default it will install that dependency before starting the tests.

An alternate way is to provide a `.pongo-setup.sh` file. If that file is present
then that file will be executed (using `source`), instead of the default behaviour.

For example, the following `.pongo-setup.sh` file will install a specific
development branch of `lua-resty-session` instead of the one specified in
the rockspec:

```shell
# remove any existing version if installed
luarocks remove lua-resty-session --force

git clone https://github.com/Tieske/lua-resty-session
cd lua-resty-session

# now checkout and install the development branch
git checkout redis-ssl
luarocks make

cd ..
rm -rf lua-resty-session
```

[Back to ToC](#table-of-contents)

## Setting up CI

Pongo is easily added to a CI setup. The examples below will asume Travis-CI, but
can be easily converted to other engines.

Here's a base setup for an open-source plugin that will test against 2 Kong versions:
```yaml
# .travis.yml

dist: bionic

jobs:
  include:
  - name: Kong CE 2.0.x
    env: KONG_VERSION=2.0.x
  - name: Kong CE 1.5.x
    env: KONG_VERSION=1.5.x

install:
- git clone --single-branch https://github.com/Kong/kong-pongo ../kong-pongo
- "../kong-pongo/pongo.sh up"
- "../kong-pongo/pongo.sh build"

script:
- "../kong-pongo/pongo.sh lint"
- "../kong-pongo/pongo.sh run"
```

To test against an Enterprise version of Kong you need to add some secrets. The
environment variables needed are:
- `KONG_LICENSE_DATA=<your Kong license json>`
- `BINTRAY_USERNAME=<your Bintray username>`
- `BINTRAY_APIKEY=<your Bintray API key>`

To create those secrets install the
[Travis command line utility](https://github.com/travis-ci/travis.rb), and
follow these steps:
- Copy the `.travis.yml` file above into your plugin repo
- Enter the main directory of your plugins repo
- Add the encrypted values by doing:

  - `travis encrypt --pro BINTRAY_USERNAME=<your_user_name_here> --add`
  - `travis encrypt --pro BINTRAY_APIKEY=<your_api_key_here> --add`
  - `travis encrypt --pro KONG_LICENSE_DATA='<license_json>' --add`

Please note the single quotes around the license data in the last one above. Since
the data is a json snippet, it must be added in single quotes. If you already have
the license data in an environment variable then the following should work:

  - `travis encrypt --pro KONG_LICENSE_DATA="'"$KONG_LICENSE_DATA"'" --add`

After completing the steps above, the `.travis.yml` file should now be updated and have this section:
```yaml
env:
  global:
  - secure: Xa6htQZoS/4K...and some more gibberish
  - secure: o8VSj7hFGm2L...and some more gibberish
  - secure: nQDng6c5xIBJ...and some more gibberish
```

Now you can update the `jobs` section and add Kong Enterprise version numbers.


[Back to ToC](#table-of-contents)

## Releasing (new Kong versions)

When new Kong versions are released, the test artifacts contained within this
Pongo repository must be updated.

To do so there are some pre-requisites;

- have [hub](https://hub.github.com/) installed and configured
- on OSX have [coreutils](https://www.gnu.org/software/coreutils/coreutils.html) installed
- have access to the `kong-pongo` (push) and `kong-ee` (read/clone) repositories on Github

Update the version as follows:

```shell
# The code-base is either "EE" (Enterprise) or "CE" (Opensource)

KONG_CODE_BASE="EE" ADD_KONG_VERSION="1.2.3" \
  && git clone http://github.com/Kong/kong-pongo.git \
  && kong-pongo/assets/add_version.sh $KONG_CODE_BASE $ADD_KONG_VERSION
```

The result should be a new PR on the Pongo repo.

[Back to ToC](#table-of-contents)
