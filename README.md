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

Options:
  --no-cassandra     do not start cassandra db
  --no-postgres      do not start postgres db
  --redis            do start redis db

Actions:
  up            start required dependency containers for testing

  build         build the Kong test image

  run           run spec files, accepts Busted options and spec files/folders
                as arguments, see: 'pongo run -- --help'

  lint          will run the LuaCheck linter

  tail          starts a tail on the specified file. Default file is
                ./servroot/logs/error.log, an alternate file can be specified

  shell         get a shell directly on a kong container

  pack          will pack all '*.rockspec' files into '*.rock' files for
                distribution (see LuaRocks package manager docs)

  down          remove all dependency containers

  status        show status of the Pongo network, images, and containers

  clean         removes the dependency containers and deletes all test images

  update        update embedded artifacts for building test images

Environment variables:
  KONG_VERSION  the specific Kong version to use when building the test image

  KONG_IMAGE    the base Kong Docker image to use when building the test image

  KONG_LICENSE_DATA
                set this variable with the Kong Enterprise license data

  POSTGRES      the version of the Postgres dependency to use (default 9.5)
  CASSANDRA     the version of the Cassandra dependency to use (default 3.9)
  REDIS         the version of the Redis dependency to use (default 5.0.4)

Example usage:
  pongo run
  KONG_VERSION=0.36-1 pongo run -v -o gtest ./spec/02-access_spec.lua
  POSTGRES=9.4 KONG_IMAGE=kong-ee pongo run
  pongo down
```

# pongo

Pongo provides a simple way of testing Kong plugins

## Requirements

Set up the following when testing against Kong Enterprise:

* Have the Kong Enterprise license key, and set it in `KONG_LICENSE_DATA`.
* Have a docker image of Kong Enterprise, and set the image name in the
  environment variable `KONG_IMAGE`, or alternatively log in to Bintray before
  running Pongo.

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

To track the error log (where any `print` or `ngx.log` statements will go) you
can use the tail command

```shell
pongo tail
```

The above would be identical to:

```shell
tail -F ./servroot/logs/error.log
```

## Test initialization

By default when the test container is started, it will look for a `.rockspec`
file, if it find one, then it will install that rockspec file with the
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

## Releasing (new Kong versions)

When new Kong versions are released, the test artifacts contained within this
Pongo repository must be updated.

To do so there are some pre-requisites;

- have [hub](https://hub.github.com/) installed and configured
- on OSX have [coreutils](https://www.gnu.org/software/coreutils/coreutils.html) installed
- have access to the `kong-pongo` and `kong-ee` repositories on Github

Update the version as follows:

```shell
# The code-base is either "EE" (Enterprise) or "CE" (Opensource)

KONG_CODE_BASE="EE" ADD_KONG_VERSION="1.2.3" \
  && git clone http://github.com/Kong/kong-pongo.git \
  && kong-pongo/assets/add_version.sh $KONG_CODE_BASE $ADD_KONG_VERSION
```

The result should be a new PR on Pongo repo.
