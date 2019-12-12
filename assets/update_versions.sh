
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

# switch to Pongo directory, since we need to run and update there
pushd $LOCAL_PATH > /dev/null


function update_repo {
    local repo_name=$1

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
}


function update_message {
    echo "Files were added/changed, please commit the changes:"
    echo "    git add kong-versions/"
    echo "    git commit"
    exit 99
}


echo "updating kong repository..."
update_repo kong
echo "updating kong-ee repository..."
update_repo kong-ee

# clean artifacts
rm -rf ./kong-versions
mkdir ./kong-versions

echo "copying files ..."
for VERSION in ${KONG_VERSIONS[*]}; do
    if $(is_enterprise $VERSION); then
        pushd ./kong-ee > /dev/null
        echo "Enterprise $VERSION"
    else
        pushd ./kong > /dev/null
        echo "Open source $VERSION"
    fi

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
    popd > /dev/null
done;


# check wether updates were made
git status > /dev/null

if ! git diff-index --quiet HEAD --
then
  update_message
fi

if git diff-files --quiet --ignore-submodules --
then
  update_message
fi
