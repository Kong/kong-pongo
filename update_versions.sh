#!/bin/bash

KONG_EE_VERSIONS="0.34 0.34-1 0.35 0.35-1 0.35-3 0.35-4 0.36 0.36-1 0.36-2"


# USAGE: this script gathers the development files from the Kong-EE source
# repository. After a new version has been released, add it to the list above
# run this script and commit the new files located in "./kong-versions".
#
# As such this can only be done if you have access to the Kong source repo.
# If you do not have access, then there is no use in running this script.



# do we need to clone the repo?
if [ ! -d "./kong-ee" ]; then
    git clone -q https://github.com/kong/kong-ee.git
    if [ ! $? -eq 0 ]; then
        echo "Error: cannot update git repo, make sure you're authorized and connected!"
        exit 1
    fi
fi

# update the repo
pushd kong-ee > /dev/null

git checkout -q master
git pull -q

if [ ! $? -eq 0 ]; then
    echo "Warning: cannot pull latest changes, make sure you're authorized and connected!"
fi

  
# clean artifacts
rm -rf ../kong-versions
mkdir ../kong-versions

echo "copying files ..."
for VERSION in $KONG_EE_VERSIONS ; do
    git checkout -q $VERSION
    if [ ! $? -eq 0 ]; then
        echo "Warning: skipping unknown version $VERSION"
    else
        echo $VERSION
        mkdir ../kong-versions/$VERSION
        mkdir ../kong-versions/$VERSION/kong
        cp    Makefile             ../kong-versions/$VERSION/kong/
        cp -R bin                  ../kong-versions/$VERSION/kong/
        cp -R spec/fixtures        ../kong-versions/$VERSION/kong/spec/
        cp    spec/helpers.lua     ../kong-versions/$VERSION/kong/spec/
        cp    spec/kong_tests.conf ../kong-versions/$VERSION/kong/spec/
        if [ -d "spec/kong-ee" ]; then
            cp -R spec-ee/fixtures     ../kong-versions/$VERSION/kong/spec-ee/
            cp    spec-ee/helpers.lua  ../kong-versions/$VERSION/kong/spec-ee/
        fi
    fi
done;

popd > /dev/null

# check wether updates were made
git status > /dev/null

if ! git diff-index --quiet HEAD --
then
  echo "Files have changed, please commit the changes"
fi

if git diff-files --quiet --ignore-submodules --
then
  echo "Files were added, please commit the changes"
fi
