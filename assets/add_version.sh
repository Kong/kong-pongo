#!/bin/bash

# use the "--debug" flag as first argument, to debug this script; setting the "set -x" option

if [[ "$1" == "--debug" ]]; then
  shift
  set -x
fi

CODE_BASE=$1
ADD_VERSION=$2
DRY_RUN=$3

LOCAL_PATH=$(dirname "$(realpath "$0")")/..

# load variables
# shellcheck disable=SC1090  # do not follow source
source "${LOCAL_PATH}/assets/set_variables.sh"


function usage {
cat << EOF

Usage:
  add_version.sh [code-base] [version] [test]

  code-base: required. Either "EE" for Kong Enterprise
             or "CE" for Kong open source.
  version:   required. The version of the product to add
             to Pongo.
  test:      add "test" to make it a test run without pushing updates

This tool will attempt to update Pongo by adding the requested version.
EOF
}


if [[ ! "$DRY_RUN" == "test" ]]; then
  if [[ ! "$DRY_RUN" == "" ]]; then
    warn "3rd parameter must be either 'test' or empty, got: '$DRY_RUN'"
    usage
    exit 1
  fi
fi


if [[ "$CODE_BASE" == "CE" ]]; then
  msg "Adding to: Kong open source"
elif [[ "$CODE_BASE" == "EE" ]]; then
  msg "Adding to: Kong Enterprise"
else
  warn "code-base, 1st parameter, must be either 'CE' or 'EE', got: '$CODE_BASE'"
  usage
  exit 1
fi


if [[ "$ADD_VERSION" == "" ]]; then
  warn "version, 2nd parameter, is missing"
  usage
  exit 1
fi
msg "Version to add: $ADD_VERSION"

#TODO: here check we're in a Pongo git repo, and on 'master' branch

if version_exists "$ADD_VERSION"; then
  err "Version '$ADD_VERSION' is already available"
  exit 1
fi

VERSIONS_FILE=${LOCAL_PATH}/assets/kong_${CODE_BASE}_versions.ver
if [[ ! -f $VERSIONS_FILE ]]; then
  err "Versions file '$VERSIONS_FILE' not found"
  exit 1
fi

# add the version to the file
echo "$ADD_VERSION" >> "$VERSIONS_FILE"
sort --version-sort "$VERSIONS_FILE" > "${VERSIONS_FILE}_tmp"

if [[ ! -f "${VERSIONS_FILE}_tmp" ]]; then
  err "Failed to add and sort the new versions file"
  exit 1
fi

mv "${VERSIONS_FILE}_tmp" "$VERSIONS_FILE"

# reload variables to add the new version to our array
# shellcheck disable=SC1090  # do not follow source
source "${LOCAL_PATH}/assets/set_variables.sh"

# add the first commit with just the added version
pushd "${LOCAL_PATH}" > /dev/null || { echo "Failure to enter $LOCAL_PATH"; exit 1; }
PREVIOUS_BRANCH=$(git rev-parse --abbrev-ref HEAD)
BRANCH_NAME=add-version-${ADD_VERSION}
git checkout -b "${BRANCH_NAME}"

git add "$VERSIONS_FILE"

if [[ "$CODE_BASE" == "CE" ]]; then
  git commit --message="feat(version) added Kong open source version $ADD_VERSION"
else
  git commit --message="feat(version) added Kong Enterprise version $ADD_VERSION"
fi

# add the artifacts and the second commit
# shellcheck disable=SC1090  # do not follow source
source "${LOCAL_PATH}/assets/update_versions.sh"
update_artifacts

if [[ ! "$?" == "99" ]]; then
  warn "Nothing was updated? nothing to commit. Please check the version"
  warn "you have added to be a valid one."
  git checkout "$PREVIOUS_BRANCH" &> /dev/null
  git branch -D "$BRANCH_NAME" &> /dev/null
  exit 1
fi

git add kong-versions/

if [[ "$CODE_BASE" == "CE" ]]; then
  git commit -q --message="chore(version) added Kong open source version $ADD_VERSION artifacts"
else
  git commit -q --message="chore(version) added Kong Enterprise version $ADD_VERSION artifacts"
fi

# push to remote and create a PR
if [[ "$DRY_RUN" == "" ]]; then
  git push --set-upstream origin "$BRANCH_NAME"
  if [[ ! $? -eq 0 ]]; then
    git checkout "$PREVIOUS_BRANCH" &> /dev/null
    err "Failed to push the branch '$BRANCH_NAME' to the remote git repo"
  fi
else
  warn "[TEST-RUN skipping] git push --set-upstream origin $BRANCH_NAME"
fi
msg "Now creating a Github pull-request:"
if [[ "$DRY_RUN" == "" ]]; then
  hub pull-request --no-edit
  if [[ ! $? -eq 0 ]]; then
    git checkout "$PREVIOUS_BRANCH" &> /dev/null
    git branch -D "$BRANCH_NAME" &> /dev/null
    err "Failed to create a PR from the '$BRANCH_NAME' branch"
  fi
else
  warn "[TEST-RUN skipping] hub pull-request --no-edit"
fi

msg "Success! A new branch '$BRANCH_NAME' was pushed to the repo (and a PR created)"
msg "with the following commits:"
git log --oneline -2
echo
git checkout "$PREVIOUS_BRANCH" &> /dev/null
git branch -D "$BRANCH_NAME" &> /dev/null
msg "done. Goto https://github.com/kong/kong-pongo/pulls to checkout the new PR."
if [[ ! "$DRY_RUN" == "" ]]; then
  warn "test-run completed, nothing was written! re-run without 'test' to push the changes."
fi
