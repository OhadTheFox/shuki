#!/bin/bash
# Run a command under the shared test lock, and say who holds it (the owner 03/10):
#   SESSION="שוקי שלב 0ב" tools/test-lock.sh node test/stories.itest.js
# While the command runs, /tmp/shuki-test.lock.owner says the session, the folder, the start time and the command;
# it goes when the lock is let go. `cat /tmp/shuki-test.lock.owner` shows who is holding it now.
LOCK=/tmp/shuki-test.lock
# tests never go out to the network: no version check against GitHub, even if the shell has UPDATE_REPO (the owner 03/10)
unset UPDATE_REPO
exec lockf -k "$LOCK" bash -c '
  owner="$0.owner"
  printf "session: %s\nfolder: %s\nsince: %s\npid: %s\ncommand: %s\n" "${SESSION:-unknown}" "$PWD" "$(date "+%F %T")" "$$" "$*" > "$owner"
  # gone on any ending, also Ctrl-C (bash 3.2 on a Mac skips EXIT on a signal); only if it is still ours
  mine() { [ "$(sed -n "s/^pid: //p" "$owner" 2>/dev/null)" = "$$" ] && rm -f "$owner"; }
  trap mine EXIT
  trap "mine; exit 130" INT; trap "mine; exit 143" TERM; trap "mine; exit 129" HUP
  "$@"
' "$LOCK" "$@"
