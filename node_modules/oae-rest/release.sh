#!/bin/bash
read -p "Github username: " uname
stty -echo
read -p "Github password: " passw; echo
stty echo
read -p "Release type (major, minor, patch or prerelease): " release

export GITHUB_USERNAME="$uname"
export GITHUB_PASSWORD="$passw"

grunt "release-version:$release"
