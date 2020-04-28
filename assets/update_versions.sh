
# USAGE: this script gathers the development files from the Kong-EE source
# repository. After a new version has been released, add it to the list above
# run this script and commit the new files located in "./kong-versions".


function update_repo {
    # updates the passed in repo name to the latest master
    local repo_name=$1

    pushd $LOCAL_PATH > /dev/null

    if [ ! -d "./$repo_name" ]; then
        local repo_url
        if [[ "$GITHUB_TOKEN" == "" ]]; then
            repo_url=https://github.com/kong/$repo_name.git
        else
            repo_url=https://$GITHUB_TOKEN:@github.com/kong/$repo_name.git
        fi
        git clone -q $repo_url
        if [ ! $? -eq 0 ]; then
            err "cannot update git repo $repo_name, make sure you're authorized and connected!"
        fi
    fi

    pushd $repo_name > /dev/null

    git checkout -q master
    git pull -q

    if [ ! $? -eq 0 ]; then
        warn "cannot pull latest changes for $repo_name, make sure you're authorized and connected!"
    fi
    popd > /dev/null
    popd > /dev/null
}


function update_all_repos {
    for REPO in kong kong-ee ; do
        msg "Cloning $REPO repository..."
        update_repo $REPO
    done;
}


function clean_artifacts {
    local VERSION=$1

    if [[ "$VERSION" == "" ]]; then
        # clean all artifacts
        rm -rf $LOCAL_PATH/kong-versions
        mkdir $LOCAL_PATH/kong-versions
    else
        # clean a single version/commit
        rm -rf $LOCAL_PATH/kong-versions/$VERSION
    fi
}


function update_single_version_artifacts {
    # MUST be in the proper git repo before calling!
    # pass in a version tag, and optionally a commit id.
    # tag is used for creating directory names etc.
    # commit id defaults to the tag if omitted
    local VERSION=$1
    local COMMIT=$2

    if [[ "$COMMIT" == "" ]]; then
      COMMIT=$VERSION
    fi

    git checkout -q $COMMIT
    if [ ! $? -eq 0 ]; then
        warn "skipping unknown version $VERSION"
    else
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

        if [[ -d spec-ee ]]; then
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

        # update old Makefile if it does not have the 'dependencies' make target
        cat ../kong-versions/$VERSION/kong/Makefile | grep dependencies: &> /dev/null
        if [[ ! $? -eq 0 ]]; then
            cat ../assets/Makefile-addition >> ../kong-versions/$VERSION/kong/Makefile
        fi
    fi
}


# The exit code is:
#  -  0 on success
#  -  1 on error
#  - 99 if new files were checked out and need to be committed
function update_artifacts {
    # removes and recreates all required test artifacts.
    pushd $LOCAL_PATH > /dev/null

    update_all_repos
    clean_artifacts

    msg "copying files ..."
    for VERSION in ${KONG_VERSIONS[*]}; do
        if $(is_enterprise $VERSION); then
            pushd ./kong-ee > /dev/null
            msg "Enterprise $VERSION"
        else
            pushd ./kong > /dev/null
            msg "Open source $VERSION"
        fi

        update_single_version_artifacts $VERSION

        popd > /dev/null
    done;

    # check wether updates were made
    if [[ ! -z $(git status -s) ]]; then
        msg "Files were added/changed, please commit the changes:"
        msg "    git add kong-versions/"
        msg "    git commit"
        popd > /dev/null
        return 99
    fi

    msg "No new files were added"
    popd > /dev/null
    return 0
}

function update_nightly {
    # $1 must be the requested version: the "NIGHTLY" special cases
    # $2 must be the commit id
    VERSION=$1
    COMMIT=$2

    local repo
    if $(is_enterprise $VERSION); then
      repo=kong-ee
    else
      repo=kong
    fi

    # update the repo to latest master
    msg "Cloning/updating $repo repository..."
    update_repo $repo

    # enter repo and update files for requested commit
    msg "Preparing development files for/at $COMMIT"
    clean_artifacts $VERSION
    pushd $LOCAL_PATH/$repo > /dev/null
    update_single_version_artifacts $VERSION $COMMIT
    popd > /dev/null
}
