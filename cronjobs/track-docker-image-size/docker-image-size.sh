#!/bin/bash
set -e
set +x

# This script computes **compressed image size with all its layers**.
# This solution is based on https://stackoverflow.com/a/55156181/314883

if [[ $# != 1 ]]; then
  echo "ERROR: absolute path to folder is expected as first argument"
  exit 1
fi

trap "cleanup; cd $(pwd -P)" EXIT
cd $1

docker save "playwright:localbuild" > "dockerimage.tar"
gzip "dockerimage.tar" >/dev/null
