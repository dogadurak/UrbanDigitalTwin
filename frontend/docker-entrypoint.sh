#!/bin/sh
set -e

# Reinstall dependencies inside the container to ensure native binaries
# match the container's OS/arch (linux-x64-musl for Alpine).
# This is necessary because the anonymous volume for node_modules
# may cache stale native binaries from a previous Node version.
npm install

exec "$@"
