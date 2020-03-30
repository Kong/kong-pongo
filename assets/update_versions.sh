
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


function update_repo {
    # updates the passed in repo name to the latest master
    local repo_name=$1

    pushd $LOCAL_PATH > /dev/null

    if [ ! -d "./$repo_name" ]; then
        git clone -q https://github.com/kong/$repo_name.git
        if [ ! $? -eq 0 ]; then
            echo "Error: cannot update git repo $repo_name, make sure you're authorized and connected!"
            exit 1
        fi
    fi

    pushd $repo_name > /dev/null

    git checkout -q master
    git pull -q

    if [ ! $? -eq 0 ]; then
        echo "Warning: cannot pull latest changes for $repo_name, make sure you're authorized and connected!"
    fi
    popd > /dev/null
    popd > /dev/null
}


function update_all_repos {
    for REPO in kong kong-ee ; do
        echo "Cloning $REPO repository..."
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
    # pass in a version tag, or a commit id
    local VERSION=$1

    git checkout -q $VERSION
    if [ ! $? -eq 0 ]; then
        echo "Warning: skipping unknown version $VERSION"
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


function update_artifacts {
    # removes and recreates all required test artifacts.
    pushd $LOCAL_PATH > /dev/null

    update_all_repos
    clean_artifacts

    echo "copying files ..."
    for VERSION in ${KONG_VERSIONS[*]}; do
        if $(is_enterprise $VERSION); then
            pushd ./kong-ee > /dev/null
            echo "Enterprise $VERSION"
        else
            pushd ./kong > /dev/null
            echo "Open source $VERSION"
        fi

        update_single_version_artifacts $VERSION

        popd > /dev/null
    done;

    # check wether updates were made
    if [[ ! -z $(git status -s) ]]; then
        echo "Files were added/changed, please commit the changes:"
        echo "    git add kong-versions/"
        echo "    git commit"
        popd > /dev/null
        return 99
    fi

    echo "No new files were added"
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
    echo "Cloning/updating $repo repository..."
    update_repo $repo

    # enter repo and update files for requested commit
    echo "Preparing development files for/at $COMMIT"
    pushd $LOCAL_PATH/$repo > /dev/null
    update_single_version_artifacts $COMMIT
    popd > /dev/null
}
