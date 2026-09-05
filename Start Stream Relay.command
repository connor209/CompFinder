#!/bin/bash
# Comp Finder — start the live stream relay (macOS / Linux).
#
# Double-click this file. It starts the relay OBS talks to, opens the host's
# desk in your browser, and stays running until you close the window. There is
# nothing to type.
#
# It lives at the repo root rather than beside the relay because the point of
# it is not having to go and find a folder.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  printf '  Node.js is not installed on this machine.\n'
  printf '  Get it from https://nodejs.org (the LTS build), then run this again.\n\n'
  read -r -p '  Press return to close. '
  exit 1
fi

# First run after a fresh clone. Silent success, loud failure — an install that
# half-worked is otherwise a relay that fails on an import three screens later.
if [ ! -d node_modules ]; then
  printf '  First run — installing dependencies, about a minute…\n\n'
  if ! npm install --no-audit --no-fund; then
    printf '\n  That install failed. The relay needs it before it can start.\n\n'
    read -r -p '  Press return to close. '
    exit 1
  fi
fi

# STREAM_ALLOW_ORIGIN: the deployed app's address, so ＋ Stream can reach the
# relay from a page served over https. Edit the line below to your own if it
# ever changes; the relay prints what it accepts when it starts.
export STREAM_ALLOW_ORIGIN="${STREAM_ALLOW_ORIGIN:-https://comp-finder.vercel.app}"

node tools/stream-relay/server.mjs

# Reached when the relay stops — usually a port already in use, which has a
# message worth reading before the window disappears.
printf '\n  The relay has stopped.\n\n'
read -r -p '  Press return to close. '
