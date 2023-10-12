#!/bin/bash

# Kong gateway prior to release 2.6 used Ubuntu 16.04 as its base
# image.  Ubuntu 16.04's package sources only have Python 3.5, which
# is insufficient to run httpie.  We thus install a more recent Python
# version from source if we're running off Ubuntu 16.04 as the base
# image.

set -e

PYTHON_SRC_VERSION=3.9.14

if [[ $(lsb_release -r -s) = "16.04" ]]
then
  echo Installing Python $PYTHON_SRC_VERSION from source
  curl -L https://www.python.org/ftp/python/$PYTHON_SRC_VERSION/Python-$PYTHON_SRC_VERSION.tgz | tar -xzf - -C /tmp
  cd /tmp/Python-$PYTHON_SRC_VERSION
  ./configure > /dev/null 2>&1
  make install > /dev/null 2>&1
  cd
  rm -rf /tmp/Python-$PYTHON_SRC_VERSION
else
  echo Installing Python from package source
  apt install -y python3 python3-pip --no-install-recommends
fi
echo "$(python3 --version) installed"
