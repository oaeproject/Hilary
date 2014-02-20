#!/bin/bash

##
# This script will package and upload a successful build to Amazon S3. It should only
# execute under the following conditions:
#
#   * The build was performed on the oaeproject repository
#   * The build was performed on the master branch
#   * The build was not performed on a pull request to the master branch
##

EXPECTED_REPOSITORY="oaeproject/Hilary"
EXPECTED_BRANCH="master"
EXPECTED_PULL_REQUEST=false

function package_and_upload {
    git reset --hard origin/master
    git checkout master
    npm shrinkwrap
    bin/package -su --upload-bucket=oae-releases-travis
}

if [[ "$TRAVIS_REPO_SLUG" == "$EXPECTED_REPOSITORY" && "$TRAVIS_BRANCH" == "$EXPECTED_BRANCH" && "$TRAVIS_PULL_REQUEST" == "$EXPECTED_PULL_REQUEST" ]]; then
    package_and_upload
fi
