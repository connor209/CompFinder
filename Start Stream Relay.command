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

# Pick up the latest code, so this file is the only thing anybody has to touch.
#
# Three rules, and the last one is the one that matters at a venue:
#   · --ff-only, so it can never stop on a merge or a conflict;
#   · skipped entirely when the working tree is dirty, because a stream night
#     is not when to discover somebody was mid-edit;
#   · a failure is a SHRUG, not a stop. No network, GitHub down, a checkout
#     with no remote — carry on with the code that is already here. The one
#     evening this has to work is the evening the wifi is worst.
BEFORE=""
if [ ! -d .git ] || ! command -v git >/dev/null 2>&1; then
  # Cloned with GitHub Desktop, which bundles its own git and does not put it
  # on the PATH. Say so: a skip nobody can see is indistinguishable from an
  # update that ran and found nothing, and the remedy is a different button.
  printf '  No git on this machine, so no update check.\n'
  printf '  Use Pull origin in GitHub Desktop if you need the latest code.\n\n'
elif [ -d .git ] && command -v git >/dev/null 2>&1; then
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    printf '  Local changes here, so leaving the code alone.\n\n'
  else
    printf '  Checking for updates...\n'
    BEFORE="$(git rev-parse HEAD 2>/dev/null)"
    # Captured rather than piped: `git pull | sed` reports SED's exit status,
    # so a `|| fallback` on the pipeline is dead code and a venue with no
    # network gets git's raw error instead of a sentence.
    if PULL_OUT="$(git pull --ff-only 2>&1)"; then
      printf '%s\n' "$PULL_OUT" | sed 's/^/    /'
    else
      printf "    (couldn't reach GitHub — carrying on with the code that is here)\n"
    fi
    printf '\n'
  fi
fi

# A pull that changed the dependencies needs an install, or the relay fails on
# an import and it looks like the update broke it.
AFTER="$(git rev-parse HEAD 2>/dev/null)"
if [ -n "$BEFORE" ] && [ "$BEFORE" != "$AFTER" ] && \
   git diff --name-only "$BEFORE" "$AFTER" 2>/dev/null | grep -q 'package-lock.json'; then
  printf '  Dependencies changed — updating them...\n\n'
  npm install --no-audit --no-fund || printf '  (that install failed; the relay may not start)\n'
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

# STREAM_ALLOW_ORIGIN: the addresses ＋ Stream may reach the relay FROM. It is
# the browser's origin that counts, not where you think the app lives — and
# comp-finder.vercel.app 307s to the custom domain, so a page opened at either
# reports the one it ended up on. Both are listed for that reason. The relay
# prints what it accepts when it starts, and names the missing one in the 403.
export STREAM_ALLOW_ORIGIN="${STREAM_ALLOW_ORIGIN:-https://compfinder.gopainting.com,https://comp-finder.vercel.app}"

node tools/stream-relay/server.mjs

# Reached when the relay stops — usually a port already in use, which has a
# message worth reading before the window disappears.
printf '\n  The relay has stopped.\n\n'
read -r -p '  Press return to close. '
