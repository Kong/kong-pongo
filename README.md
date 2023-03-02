[![Unix Tests](https://img.shields.io/github/actions/workflow/status/Kong/kong-pongo/test.yml?branch=master&label=Unix%20tests&logo=linux)](https://github.com/Kong/kong-pongo/actions/workflows/test.yml)
[![Docker Tests](https://img.shields.io/github/actions/workflow/status/Kong/kong-pongo/test.yml?branch=master&label=Docker%20tests&logo=docker)](https://github.com/Kong/kong-pongo/actions/workflows/docker.yml)
[![Lint](https://github.com/Kong/kong-pongo/workflows/Lint/badge.svg)](https://github.com/Kong/kong-pongo/actions/workflows/lint.yml)
[![SemVer](https://img.shields.io/github/v/tag/Kong/kong-pongo?color=brightgreen&label=SemVer&logo=semver&sort=semver)](README.md#changelog)

| :exclamation:  Important compatibility notes |
|:---------------------------|
| Pongo has been switched from non-versioned to versioned on 17-Mar-2022. On 20-Oct-2022 version 2.0.0 was pushed to `master` and released. This means that breaking changes were introduced on `master`. If you experience failures, then either pin your Pongo version to 1.x or [upgrade](#upgrading) |

# pongo

Pongo provides a simple way of testing Kong plugins. For a complete walkthrough
check [this blogpost on the Kong website](https://konghq.com/blog/custom-lua-plugin-kong-gateway).


```
                /~\
  ______       C oo
  | ___ \      _( ^)
  | |_/ /__  _/__ ~\ __   ___
  |  __/ _ \| '_ \ / _ `|/ _ \
  | | | (_) | | | | (_| | (_) |
  \_|  \___/|_| |_|\__, |\___/
                    __/ |
                   |___/  v2.5.0

Usage: pongo action [options...] [--] [action options...]

Options (can also be added to '.pongo/pongorc'):
  --no-postgres      do not start postgres db
  --cassandra        do start cassandra db
  --grpcbin          do start grpcbin (see readme for info)
  --redis            do start redis db (see readme for info)
  --squid            do start squid forward-proxy (see readme for info)

Project actions:
  init          initializes the current plugin directory with some default
                configuration files if not already there (not required)

  lint          will run the LuaCheck linter

  pack          will pack all '*.rockspec' files into '*.rock' files for
                distribution (see LuaRocks package manager docs)

  run           run spec files, accepts Busted options and spec files/folders
                as arguments, see: 'pongo run -- --help'

  shell         get a shell directly on a kong container

  tail          starts a tail on the specified file. Default file is
                ./servroot/logs/error.log, an alternate file can be specified

Environment actions:
  build         build the Kong test image, add '--force' to rebuild images

  clean / nuke  removes the dependency containers and deletes all test images

  docs          will generate and open the test-helper documentation

  down          remove all dependency containers

  expose        expose the internal ports for access from the host

  logs          show docker-compose logs of the Pongo environment

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
  CASSANDRA     the version of the Cassandra dependency to use (default 3.11)
  REDIS         the version of the Redis dependency to use (default 6.2.6)

Example usage:
  pongo run
  KONG_VERSION=1.3.x pongo run -v -o gtest ./spec/02-access_spec.lua
  POSTGRES=10 KONG_IMAGE=kong-ee pongo run
  pongo down
```

## Table of contents

 - [Requirements](#requirements)
 - [Installation](#installation)
 - [Update](#update)
 - [Configuration](#configuration)
 - [Do a test run](#do-a-test-run)
 - [Pongo on Windows](#pongo-on-windows)
 - [Test dependencies](#test-dependencies)
    - Postgres (Kong datastore)
    - Cassandra (Kong datastore)
    - grpcbin (mock grpc backend)
    - Redis (key-value store)
    - Squid (forward-proxy)
    - [Dependency defaults](#dependency-defaults)
    - [Dependency troubleshooting](#dependency-troubleshooting)
    - [Custom local dependencies](#custom-local-dependencies)
 - [Debugging](#debugging)
     - [Accessing the logs](#accessing-the-logs)
     - [Direct access to service ports](#direct-access-to-service-ports)
 - [Test initialization](#test-initialization)
 - [Test coverage](#test-coverage)
 - [Setting up CI](#setting-up-ci)
     - [CI against development builds](#ci-against-development-builds)
     - [CI with Kong Enterprise](#ci-with-kong-enterprise)
     - [CI with Kong Enterprise development](#ci-with-kong-enterprise-development)
 - [Running Pongo in Docker](#running-pongo-in-docker)
 - [Releasing new Kong versions](#releasing-new-kong-versions)
 - [Changelog](#changelog)

## Requirements

Tools Pongo needs to run:
* `docker-compose` (and hence `docker`)
* `curl`
* `realpath`, for MacOS you need the [`coreutils`](https://www.gnu.org/software/coreutils/coreutils.html)
  to be installed. This is easiest via the [Homebrew package manager](https://brew.sh/) by doing:
  ```
  brew install coreutils
  ```
* depending on your environment you should set some [environment variables](#configuration).

[Back to ToC](#table-of-contents)

## Installation

Clone the repository and install Pongo:
```shell
PATH=$PATH:~/.local/bin
git clone https://github.com/Kong/kong-pongo.git
mkdir -p ~/.local/bin
ln -s $(realpath kong-pongo/pongo.sh) ~/.local/bin/pongo
```

## Update

Since the Pongo script is symbolic linked to `~/.local/bin/pongo`, in order to update Pongo, all you have to do is to fetch latest changes from the Pongo repo:

```
cd <cloned Pongo repo>
git pull
```

[Back to ToC](#table-of-contents)

## Configuration

Several environment variables are available for configuration:

* Docker credentials; `DOCKER_USERNAME` and `DOCKER_PASSWORD` to prevent rate-
  limits when pulling images, but also for testing against older Kong Enterprise
  images that are not publicly available.
* Kong license; set `KONG_LICENSE_DATA` with the Enterprise license to enable
  Enterprise features.
* Specify a custom image; set the image name/tag in `KONG_IMAGE` and make sure
  the image is locally available

For Kong-internal use there are some additional variables:

* `PULP_USERNAME` and `PULP_PASSWORD` to automatically download the Kong
  Enterprise CI license. See [Setting up CI](#setting-up-ci) for some Pulp
  environment variable examples.
* `GITHUB_TOKEN` the Github token to get access to the Kong Enterprise source
  code. This is only required for development builds, not for released
  versions of Kong.

[Back to ToC](#table-of-contents)

## Do a test run

Get a shell into your plugin repository, and run `pongo`, for example:

```shell
git clone https://github.com/Kong/kong-plugin.git
cd kong-plugin

# auto pull and build the test images
pongo run
```

Some more elaborate examples:

```shell
# Run against a specific version of Kong and pass
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

## Pongo on Windows

Beta: Pongo should run in Git-BASH if you have [Git for Windows](https://gitforwindows.org/)
installed (and Docker for Windows). Please report any issues.

To run Pongo on Windows you can use [WSL2](https://docs.microsoft.com/windows/wsl/)
(Windows Subsystem for Linux).

* install WSL2
* install Docker for Windows
* from the Microsoft Store install Debian (search for `Debian`)
* start Debian (should be in your start menu)
* now from the prompt install Pongo and some dependencies;

      sudo apt update
      sudo apt install git curl coreutils

      cd ~
      git clone https://github.com/Kong/kong-pongo.git
      mkdir -p ~/.local/bin
      ln -s $(realpath kong-pongo/pongo.sh) ~/.local/bin/pongo
      PATH=$PATH:~/.local/bin

* Open Docker for Windows and open the settings
* under "General" enable using the WSL2 engine
* under "Resources - WSL integration" enable integration with the Debian package

You can now edit your code with your favorite Windows IDE or editor and then run
the tests with Pongo.

To give this a try using the template plugin;

* download or clone `https://github.com/Kong/kong-plugin.git` (assuming this to
  land in `C:\users\tieske\code\kong-plugin`)
* start Debian and at the prompt do:

      cd /mnt/c/users/tieske/code/kong-plugin
      pongo run


[Back to ToC](#table-of-contents)

## Test dependencies

Pongo can use a set of test dependencies that can be used to test against. Each
can be enabled/disabled by respectively specifying `--[dependency_name]` or
`--no-[dependency-name]` as options for the `pongo up`, `pongo restart`, and
`pongo run` commands. The alternate way of specifying the dependencies is
by adding them to the `.pongo/pongorc` file (see below).

The available dependencies are:

* **Postgres** Kong datastore (started by default)
  - Disable it with `--no-postgres`
  - The Postgres version is controlled by the `POSTGRES` environment variable

* **Cassandra** Kong datastore
  - Enable it with `--cassandra`
  - The Cassandra version is controlled by the `CASSANDRA` environment variable

* **grpcbin** mock grpc backend
  - Enable it with `--grpcbin`
  - The engine is [moul/grpcbin](https://github.com/moul/grpcbin)
  - From within the environment it is available at:
      * `grpcbin:9000` grpc over http
      * `grpcbin:9001` grpc over http+tls

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
    pongo up --squid --no-postgres
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
a per project/plugin basis, a `.pongo/pongorc` file can be added
to the project.

The format of the file is very simple; each line contains 1 commandline option, eg.
a `.pongo/pongorc` file for a plugin that only needs Postgres and Redis:

  ```shell
  --no-cassandra
  --redis
  ```

[Back to ToC](#table-of-contents)

### Dependency troubleshooting

When dependency containers are causing trouble, the logs can be accessed using
the `pongo logs` command. This command is the same as `docker-compose logs` except
that it operates on the Pongo environment specifically. Any additional options
specified to the command will be passed to the underlying `docker-compose logs`
command.

Some examples:
```shell
# show latest logs
pongo logs

# tail latest logs
pongo logs -f

# tail latest logs for the postgres dependency
pongo logs -f postgres
```

[Back to ToC](#table-of-contents)

### Custom local dependencies

If the included dependencies are not enough for testing a plugin, then Pongo allows
you to specify your own dependencies.
To create a custom local dependency you must add its name to the `.pongo/pongorc` file
An example defining 2 extra dependencies; `zipkin`, and `myservice`:

  ```shell
  --no-cassandra
  --redis
  --zipkin
  --no-myservice
  ```

This defines both services, with `zipkin` being started by default and `myservice`
only when specifying it like this;

  ```
  pongo up --myservice
  ```

This only defines the dependency, but it also needs a configuration. The
configuration is a `docker-compose` file specific for each dependency. So taking
the above `zipkin` example we create a file named `.pongo/zipkin.yml`.

  ```yml
  version: '3.5'

  services:
    zipkin:
      image: openzipkin/zipkin:${ZIPKIN:-2.19}
      healthcheck:
        interval: 5s
        retries: 10
        test:
        - CMD
        - wget
        - localhost:9411/health
        timeout: 10s
      restart: on-failure
      stop_signal: SIGKILL
      networks:
        - ${NETWORK_NAME}
  ```

The components of the file:

  - file name: based on the dependency name; `./pongo/<dep-name>.yml`
  - service name: this must be the dependency name as defined, in this case `zipkin`
  - `image` is required, the environment variable `ZIPKIN` to override the default
    version `2.19` is optional
  - `healthcheck` if available then Pongo uses the health-status to determine
    whether a dependency is ready and the test run can be started.
  - `networks` should be included and left as-is to include the dependency in the
    network with the other containers.

Some helpfull examples:
  - Dependencies requiring configuration files: see `squid` in the main [Pongo
    docker-compose file](https://github.com/Kong/kong-pongo/blob/master/assets/docker-compose.yml).
  - A custom dependency example: see the [Zipkin plugin](https://github.com/Kong/kong-plugin-zipkin)

[Back to ToC](#table-of-contents)

## Debugging

This section is about debugging plugin code. If you have trouble with the Pongo
environment then check [Dependency troubleshooting](#dependency-troubleshooting).

### Accessing the logs

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

The above does not work in a CI environment. So how to get access to the logs in
that case?

From the default `.travis.yml` (see [chapter on CI](#setting-up-ci)), change the
basic lines to run the commands as follows, from;

    script:
    - "../kong-pongo/pongo.sh lint"
    - "../kong-pongo/pongo.sh run"

to;

    script:
    - "../kong-pongo/pongo.sh lint"
    - "KONG_TEST_DONT_CLEAN=true ../kong-pongo/pongo.sh run"
    - "cat servroot/logs/error.log"

Setting the `KONG_TEST_DONT_CLEAN` variable will instruct Kong to not clean up
the working directory in between tests. And the final `cat` command will output
the log to the Travis console.

[Back to ToC](#table-of-contents)

### Direct access to service ports

To directly access Kong from the host, or the datastores, the `pongo expose`
command can be used to expose the internal ports to the host.

This allows for example to connect to the Postgres on port `5432` to validate
the contents of the database. Or when running `pongo shell` to manually
start Kong, you can access all the regular Kong ports from the host, including
the GUI's.

This has been implemented as a separate container that opens all those ports and
relays them on the docker network to the actual service containers (the reason
for this is that regular Pongo runs do not interfere with ports already in use
on the host, only if `expose` is used there is a risk of failure because ports
are already in use on the host)

Since it is technically a "dependency" it can be specified as a dependency as
well.

so
```shell
pongo up
pongo expose
```
is equivalent to
```shell
pongo up --expose
```

See `pongo expose --help` for the ports.

[Back to ToC](#table-of-contents)


## Test initialization

By default when the test container is started, it will look for a `.rockspec`
file, if it finds one, then it will install that rockspec file with the
`--deps-only` flag. Meaning it will not install that rock itself, but if it
depends on any external libraries, those rocks will be installed. If the rock
is already installed in the image, it will be uninstalled first.

For example; the Kong plugin `session` relies on the `lua-resty-session` rock.
So by default it will install that dependency before starting the tests.

To modify the default behaviour there are 2 scripts that can be hooked up:

* `.pongo/pongo-setup-host.sh` this script will be executed (not sourced) right
  before the Kong test container is started. Hence this script runs **on the host**.
  The interpreter can be set using the regular shebang.

* `.pongo/pongo-setup.sh` is ran upon container start **inside** the Kong
  container. It will not be executed but sourced, and will run on `/bin/bash` as
  interpreter.

Both scripts will have an environment variable `PONGO_COMMAND` that will have
the current command being executed, for example `shell` or `run`.

Below an example using both files. On the host it clones a dependency if it
isn't available already. This prevents pulling it on each run, but makes sure it
is available in CI. Then on each run it will install the dependency in the
container first and then it will do the default action of installing all
rockspecs found.

Example `.pongo/pongo-setup-host.sh`:
```shell
#!/usr/bin/env bash

# this runs on the host, before the Kong container is started
if [ ! -d "my_dependency" ]; then
  git clone https://github.com/memyselfandi/my_dependency.git
fi
```

Example `.pongo/pongo-setup.sh`:
```shell
#!/usr/bin/env bash

# this runs in the test container upon starting it
cd /kong-plugin/my_dependency
make install

# additionally run the default action of installing rockspec dependencies
/pongo/default-pongo-setup.sh
```

[Back to ToC](#table-of-contents)

## Test coverage

Pongo has support for the LuaCov code coverage tool. But this is rather limited.
LuaCov is not able to run in OpenResty, hence it will not report on integration
tests, only on unit tests.

To enable LuaCov, run `pongo init` to create the `.luacov` configuration file, and
then run the tests using the Busted `--coverage` option like this:

```shell
pongo run -- --coverage
```

After the test run the output files `luacov.*.out` files should be available.

[Back to ToC](#table-of-contents)

## Setting up CI

Pongo is easily added to a CI setup. The examples below will asume Travis-CI, but
can be easily converted to other engines.

**Note**: if your engine of preference runs itself in Docker, then checkout [Pongo in Docker](#running-pongo-in-docker).

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

[Back to ToC](#table-of-contents)

### CI against development builds

To test against development builds, the CRON option for Travis-CI should be configured.
This will trigger a daily test-run.

In the test matrix add a job with `KONG_VERSION=dev`, like this:

```yaml
jobs:
  include:
  - name: Kong master-branch
    env: KONG_VERSION=dev
```

[Back to ToC](#table-of-contents)

### CI with Kong Enterprise

To test against an Enterprise version of Kong the same base setup can be used, but
some secrets need to be added. With the secrets in place Pongo will be able to
download the proper Kong Enterprise images and license keys. See [Configuration](#configuration)
for details on the environment variables.

The environment variables:
- `DOCKER_USERNAME=<your_docker_username>`
- `DOCKER_PASSWORD=<your_docker_password>`
- `KONG_LICENSE_DATA=<your_license_data>`

Kong internal only:
- `PULP_USERNAME=<your_pulp_username>` (Optional, if KONG_LICENSE_DATA not set)
- `PULP_PASSWORD=<your_pulp_password>` (Optional, if KONG_LICENSE_DATA not set)

To test the Pulp values try the following command, if succesful it will display
your license key:
```
$ curl -L -u"$PULP_USERNAME:$PULP_PASSWORD" "https://download.konghq.com/internal/kong-gateway/license.json"
```

Once the test command is succesful you can add the secrets to the Travis-CI
configuration. To add those secrets install the
[Travis command line utility](https://github.com/travis-ci/travis.rb), and
follow these steps:
- Copy the `.travis.yml` file above into your plugin repo
- Enter the main directory of your plugins repo
- Add the encrypted values by doing:

  - `travis encrypt --pro DOCKER_USERNAME=<your_docker_username> --add`
  - `travis encrypt --pro DOCKER_PASSWORD=<your_docker_password> --add`
  - `travis encrypt --pro KONG_LICENSE_DATA=<your_license_data> --add`
  - `travis encrypt --pro PULP_USERNAME=<your_pulp_username> --add`
  - `travis encrypt --pro PULP_PASSWORD=<your_pulp_password> --add`

After completing the steps above, the `.travis.yml` file should now be updated
and have this additional section:

```yaml
env:
  global:
  - PONGO_SECRETS_AVAILABLE=$TRAVIS_SECURE_ENV_VARS
  - secure: Xa6htQZoS/4K...and some more gibberish
  - secure: o8VSj7hFGm2L...and some more gibberish
  - secure: nQDng6c5xIBJ...and some more gibberish
```

Now you can update the `jobs` section and add Kong Enterprise version numbers.

**Note**: the variable PONGO_SECRETS_AVAILABLE works the same as [TRAVIS_SECURE_ENV_VARS](https://docs.travis-ci.com/user/environment-variables/#default-environment-variables).
If you receive PR's from outside your organization, then the secrets will not be
available on a CI run, this will cause the build to always fail. If you set this
variable to `false` then Pongo will print only a warning and exit with success.
Effectively this means that external PR's are only tested against Kong opensource
versions, and internal PR's will be tested against opensource and Enterprise
versions of Kong.

(It is mentioned for completeness in the example above, since Pongo will
automatically fall back on the Travis-CI variable, on other CI engines you will
need to set it)

[Back to ToC](#table-of-contents)

### CI with Kong Enterprise development

**Note: this is NOT publicly available, only Kong internal**

This build will also require a CRON job to build on a daily basis, but also
requires additional credentials to access the Kong Enterprise master image.
To build against the Enterprise master, the version can be specified as
`dev-ee`, as given in this example:

```yaml
jobs:
  include:
  - name: Kong Enterprise master-branch
    env: KONG_VERSION=dev-ee
```

For this to work the following variables must be present:
- `DOCKER_USERNAME=<your_docker_username>`
- `DOCKER_PASSWORD<your_docker_password>`

At least the api-key must be encrypted as a secret. Follow the instructions above
to encrypt and add them to the `.travis.yml` file.

For the development builds Pongo needs to pull the Kong-EE source. If the repo
under test does not have access, then a valid GitHub access token is also
required to refresh the Kong Enterprise code, and must be specified as a
`GITHUB_TOKEN` environment variable.

[Back to ToC](#table-of-contents)

## Running Pongo in Docker

Pongo relies on Docker and Docker-compose to recreate environments and test
setups. So what if your environment is running Pongo itself in a Docker
container?

[Docker-in-Docker has some serious issues when used in CI](http://jpetazzo.github.io/2015/09/03/do-not-use-docker-in-docker-for-ci/)
(as it was intended for Docker development only).
The proposed solution in that blog post actually works with Pongo. By starting
the container running Pongo with the

    -v /var/run/docker.sock:/var/run/docker.sock

option, the container will get control over the Docker deamon on the host. The
means that the test environment spun up by Pongo will not run inside the Pongo
container (as children) but along side the Pongo container (as siblings).
To share the plugin code and tests with the (sibling) test container Pongo will
need a shared working directory on the host. This working directory must be
mapped to `/pongo_wd` on the container running Pongo.

Additionally the container id must be made available to the Pongo container. It must
be in a file `.containerid` in the same working directory.

_**WARNING**: make sure to read up on the security consequences of sharing `docker.sock`! You are allowing a Docker container to control the Docker deamon on the host!_

For a working example see [the Pongo repo](https://github.com/Kong/kong-pongo/tree/master/assets/docker).

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
# The code-base (1st argument) is either "EE" (Enterprise) or "CE" (Opensource)
# 2nd argument is the version to add.
# 3rd argument makes it a test run if given

assets/add_version.sh "EE" "1.2.3" "test"
```

Here's an all-in-one command, edit the parameters as needed;
```
git clone --single-branch https://github.com/Kong/kong-pongo $TMPDIR/kong-pongo && $TMPDIR/kong-pongo/assets/add_version.sh "EE" "1.2.3" "test"; rm -rf $TMPDIR/kong-pongo
```

The result should be a new PR on the Pongo repo.

[Back to ToC](#table-of-contents)

# Changelog

#### releasing new versions

 * create a release branch for Pongo; `release/x.y.z`
    * update the changelog below
    * update version in logo at top of this `README`
    * update version in `pongo.sh`
    * commit as `release x.y.z`
    * push the release branch, and create a Pongo PR
 * manually test with Kong-Enterprise
    * create a PR that changes Kong-Enterprise tests to use the Pongo release branch
    * add a link in the PR description to the Pongo release PR for cross-referencing
    * mark the PR as "draft"
    * example where/how to make the change: https://github.com/Kong/kong-ee/pull/4156. Copy the to-do list from the PR description!
    * make sure it passes, adjust if required
 * merge the Pongo release branch, tag as `x.y.z`, and push the tag
 * update Kong-Enterprise PR (created in the first step)
    * Change the Pongo version to use to the newly released version of Pongo
    * remove "draft" status.

---

## 2.5.0 unreleased

* Fix: Apple recently started shipping `realpath` in their OS. But it doesn't support the
  `--version` flag, so it was not detected as installed
  [#380](https://github.com/Kong/kong-pongo/pull/380).

* Feat: Kong Enterprise 3.1.1.3

* Feat: Kong Enterprise 3.1.1.2

* Fix: Add missing `fuser` and `netstat` utility that is required for certain test functions.

---

## 2.4.0 released 20-Jan-2023

* Fix: Redis certificates [#370](https://github.com/Kong/kong-pongo/pull/370)

* Feat: Kong Enterprise 3.1.1.1

* Feat: Kong Enterprise 3.1.1.0

* Feat: Kong Enterprise 3.0.2.0

* Feat: Kong OSS 3.1.1

* Feat: Kong OSS 3.0.2

* Feat: Kong OSS 2.8.2

## 2.3.0 released 9-Dec-2022

* Feat: Kong Enterprise 3.1.0.0

* Feat: Kong Enterprise 3.0.1.0

* Feat: Kong OSS 3.1.0

---

## 2.2.0 released 18-Nov-2022

* Feat: Only build Python from source if the Kong base image is based
  on Ubuntu 16.04

---

## 2.1.0 released 15-Nov-2022

* Feat: Kong OSS 3.0.1

* Feat: add the Pongo version that build the image to the image, and check it
  against the used version to inform user of mismatches.

* Fix: import declarative config in Enterprise versions (officially not supported)
  in the 'kms' shell alias.

* Style: change redis cluster service name from `rc` to `redis-clusters`.
  Refer to PR <https://github.com/Kong/kong-pongo/pull/344>.

---

## 2.0.0 released 20-Oct-2022

#### Upgrading

* Upgrade Pongo

  * run `pongo clean` using the `1.x` version of Pongo, to cleanup old artifacts
    and images

  * `cd` into the folder where Pongo resides and do a `git pull`, followed by
    `git checkout 2.0.0`

* Upgrade Plugin repositories

  * on your plugin repositories run `pongo init` to update any settings (git-ignoring
    bash history mostly)

  * if your test matrix for Kong versions to test against include Kong CE versions prior
    to `2.0` or Kong EE versions prior to `3.0` then update the CI to use the proper
    version of Pongo that supports those versions. So pick a Pongo version depending
    on the Kong version being tested.

  * if your test matrix for Kong versions to test against includes `nightly`
    and/or `nightly-ee` then those should respectively be updated to `dev` and
    `dev-ee`.

  * If you need Cassandra when testing, then ensure in the plugin repositories that
    the `.pongo/pongorc` file contains: `--cassandra`, since it is no longer started
    by default.

  * Update test initialization scripts `.pongo/pongo-setup.sh`. They will now be
    sourced in `bash` instead of in `sh`.

#### Changes

* [BREAKING] the Kong base image is now `Ubuntu` (previously `Alpine`). The default
  shell now is `/bin/bash` (was `/bin/sh`)

* [BREAKING] Support for Kong Enterprise versions before `3.0` is dropped (this is
  because for Enterprise there were never Ubuntu images published in the 2.x range)

* [BREAKING] Support for Kong opensource versions before `2.0` is dropped

* [BREAKING] Cassandra is no longer started by default.

* [BREAKING] The version tags to test against Kong development branches; `nightly`
  and `nightly-ee` have been renamed to `dev` and `dev-ee` (because they are not
  nightlies but the latest commit to the master branch)

* Feat: new tags have been defined to test against the latest stable/released
  versions of Kong and Kong Enterprise; `stable` and `stable-ee`

* Fix: if the license cannot be downloaded the license variable would contain the
  404 html response, which would cause unrelated problems. The variable is now
  cleared upon failure.

---

## 1.3.0 released 19-Sep-2022

* Feat: Kong Enterprise 3.0.0.0

* Feat: Kong OSS 3.0.0

* Fix: change the `kong` user to the ID of the `/kong-plugin` folder owner, to
  prevent permission issues when starting Kong (access to the `servroot` working
  directory which is located in the mounted folder)
  [#321](https://github.com/Kong/kong-pongo/pull/321)

* Fix: location of the unofficial Kong image (used between releasing and
  Docker hub availability).

---

## 1.2.1 released 09-Sep-2022

 * Fix: format for reedis cluster support
   [#318](https://github.com/Kong/kong-pongo/pull/318)

 * Fix: workaround for https://github.com/Kong/kong/issues/9365
   [#314](https://github.com/Kong/kong-pongo/pull/314)

---

## 1.2.0 released 01-Sep-2022

* Feat: Kong Enterprise 2.8.1.2, 2.8.1.3, 2.8.1.4

* Added a Pongo github action, see the [marketplace](https://github.com/marketplace/actions/kong-pongo)

* Enabled redis cluster tests
  [#305](https://github.com/Kong/kong-pongo/pull/305)

* Export the new `KONG_SPEC_TEST_REDIS_HOST` variable to be compatible with Kong 3.0.0+
  [#290](https://github.com/Kong/kong-pongo/pull/290)

* Aliases now support `.yml` and `.json` extension for declarative config file
  [#296](https://github.com/Kong/kong-pongo/pull/296)

* Changed nightly-ee image to the new `master` tag
  [#300](https://github.com/Kong/kong-pongo/pull/300)

* Added new alias "kx" for export, and added explanation when shelling
  [#311](https://github.com/Kong/kong-pongo/pull/311)

---

## 1.1.0 released 14-Jun-2022

* Feat: Kong Enterprise 2.6.1.0, 2.7.2.0, 2.8.0.0, 2.8.1.0, 2.8.1.1

* Feat: Kong OSS 2.4.2, 2.5.2, 2.6.1, 2.7.2, 2.8.0, 2.8.1

* Feat: Enable SSL for Redis on port `6380`
  [#270](https://github.com/Kong/kong-pongo/pull/270)

* Feat: The `--debug` flag now also sets docker build command to `--progress plain`
  for easier debugging of the build. It also does `set -x` so be careful not
  to copy-paste secrets somewhere!!
  [#283](https://github.com/Kong/kong-pongo/pull/283)

* Change: Upgrade image `redis:5.0.4-alpine` to `redis:6.2.6-alpine`

* Fix: Packing rocks was limited to single-digit rockspec revisions
  [#289](https://github.com/Kong/kong-pongo/pull/289)

* Fix: Add `python3-dev` package to fix the `httpie` installation
  [#283](https://github.com/Kong/kong-pongo/pull/283)

* Fix: Fix rock installation issue due to unauthenticated Git protocol
  [#266](https://github.com/Kong/kong-pongo/pull/266)

* Fix: Upgrade cassandra image from 3.9 to 3.11 for M1 chip
  [#269](https://github.com/Kong/kong-pongo/pull/269)

---

## 1.0.0 released 1-Feb-2022

* Initial versioned release of Pongo

[Back to ToC](#table-of-contents)
