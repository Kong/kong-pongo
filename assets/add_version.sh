#!/bin/bash

CODE_BASE=$1
ADD_VERSION=$2
LOCAL_PATH=$(dirname "$(realpath "$0")")/..

# load variables
source ${LOCAL_PATH}/assets/set_variables.sh


function usage {
cat << EOF

Usage:
  add_version.sh [code-base] [version]

  code-base: required. Either "EE" for Kong Enterprise
             or "CE" for Kong open source.
  version:   required. The version of the product to add
             to Pongo.

This tool will attempt to update Pongo by adding the requested version.
EOF
}


if [[ "$CODE_BASE" == "CE" ]]; then
  echo "Adding to:      Kong open source"
elif [[ "$CODE_BASE" == "EE" ]]; then
  echo "Adding to:      Kong Enterprise"
else
  echo "code-base must be either 'CE' or 'EE'"
  usage
  exit 1
fi


if [[ "$ADD_VERSION" == "" ]]; then
  echo "version is missing"
  usage
  exit 1
fi
echo "Version to add: $ADD_VERSION"

#TODO: here check we're in a Pongo git repo, and on 'master' branch

if $(version_exists $ADD_VERSION); then
  echo "Version '$ADD_VERSION' is already available"
  exit 1
fi

VERSIONS_FILE=${LOCAL_PATH}/assets/kong_${CODE_BASE}_versions.ver
if [[ ! -f $VERSIONS_FILE ]]; then
  echo "Versions file '$VERSIONS_FILE' not found"
  exit 1
fi

# add the version to the file
echo "$ADD_VERSION" >> $VERSIONS_FILE
sort --version-sort $VERSIONS_FILE > ${VERSIONS_FILE}_tmp

if [[ ! -f ${VERSIONS_FILE}_tmp ]]; then
  echo "Failed to add and sort the new versions file"
  exit 1
fi

mv ${VERSIONS_FILE}_tmp $VERSIONS_FILE

# reload variables to add the new version to our array
source ${LOCAL_PATH}/assets/set_variables.sh

# add the first commit with just the added version
pushd ${LOCAL_PATH} > /dev/null
PREVIOUS_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BRANCH_NAME=add-version-${ADD_VERSION}
git checkout -b ${BRANCH_NAME}

git add $VERSIONS_FILE

if [[ "$CODE_BASE" == "CE" ]]; then
  git commit --message="feat(version) added Kong open source version $ADD_VERSION"
else
  git commit --message="feat(version) added Kong Enterprise version $ADD_VERSION"
fi

# add the artifacts and the second commit
source ${LOCAL_PATH}/assets/update_versions.sh
update_artifacts

if [[ ! "$?" == "99" ]]; then
  echo "Nothing was updated? nothing to commit. Please check the version"
  echo "you have added to be a valid one."
  git checkout $PREVIOUS_BRANCH
  git branch -D $BRANCH_NAME
  exit 1
fi

git add kong-versions/

if [[ "$CODE_BASE" == "CE" ]]; then
  git commit -q --message="chore(version) added Kong open source version $ADD_VERSION artifacts"
else
  git commit -q --message="chore(version) added Kong Enterprise version $ADD_VERSION artifacts"
fi

# push to remote anmd create a PR
git push --set-upstream origin $BRANCH_NAME
echo
echo "Now creating a Github pull-request:"
hub pull-request --no-edit
echo
echo "Success! A new branch '$BRANCH_NAME' was pushed to the repo (and a PR created)"
echo "with the following commits:"
git log --oneline -2
echo
git checkout $PREVIOUS_BRANCH &> /dev/null
