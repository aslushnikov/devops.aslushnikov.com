#!/bin/bash
set -e
set +x

# This script exports image with all its layers.
# Based on https://stackoverflow.com/a/55156181/314883

docker save "playwright:localbuild" > "dockerimage.tar"
