#!/bin/bash

# Pre 0.36 is not supported (make target 'dependencies' is missing)
KONG_EE_VERSIONS="0.36 0.36-1 0.36-2"


# USAGE: this script gathers the development files from the Kong-EE source
# repository. After a new version has been released, add it to the list above
# run this script and commit the new files located in "./kong-versions".
#
# As such this can only be done if you have access to the Kong source repo.
# If you do not have access, then there is no use in running this script.
#
# The exit code is:
#  -  0 on success
#  -  1 on error
#  - 99 if new files were checked out and need to be committed



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

        mkdir ../kong-versions/$VERSION/kong/spec
        for fname in spec/*; do
            case $fname in
            (spec/[0-9]*)
                # These we skip
                ;;
            (*) 
                # everything else we copy
                cp -R "$fname" ../kong-versions/$VERSION/kong/spec/
                ;;
            esac
        done

        mkdir ../kong-versions/$VERSION/kong/spec-ee
        for fname in spec-ee/*; do
            case $fname in
            (spec-ee/[0-9]*)
                # These we skip
                ;;
            (*) 
                # everything else we copy
                cp -R "$fname" ../kong-versions/$VERSION/kong/spec-ee/
                ;;
            esac
        done
    fi
done;

popd > /dev/null

# check wether updates were made
git status > /dev/null

if ! git diff-index --quiet HEAD --
then
  echo "Files have changed, please commit the changes"
  exit 99
fi

if git diff-files --quiet --ignore-submodules --
then
  echo "Files were added, please commit the changes"
  exit 99
fi
