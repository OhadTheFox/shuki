#!/bin/bash
# All tests on the fake model, one at a time, each under the shared lock. Usage: tools/runall.sh OUTDIR [itest|ui|unit ...]
# ITESTS="test/a.itest.js ..." / UIS="test/a-ui.cjs ...": only those ("test/r20-ios-ui.cjs@webkit": in WebKit, stage 5). ROOT: the repo (default: the stage0 worktree)
cd "${ROOT:-$(dirname "$0")/..}"
OUT=$1; shift; mkdir -p $OUT; : > $OUT/summary.txt
unset STORIES_NOW STORIES_ONLY UPDATE_REPO # the full run: no diagnosing knobs, no network
# Playwright and axe outside /tmp, which macOS cleans (the owner 05/10): PW_HOME, or PW / AXE themselves, to use others
PW_HOME="${PW_HOME:-$HOME/.cache/shuki-pw}"
export PW="${PW:-$PW_HOME/node_modules/playwright}" AXE="${AXE:-$PW_HOME/axe.min.js}"
SETSID="python3 -c import\ os,sys;os.setsid();os.execvp(sys.argv[1],sys.argv[1:])"
setsid_run() { python3 -c 'import os,sys;os.setsid();os.execvp(sys.argv[1],sys.argv[1:])' "$@"; }
KINDS="${@:-unit itest ui}"
for k in $KINDS; do
 if [ $k = unit ]; then
  SESSION="stage0 0e full run" tools/test-lock.sh node --test test/*.test.js > $OUT/unit.log 2>&1; echo "unit rc=$?" >> $OUT/summary.txt
 elif [ $k = itest ]; then
  for f in ${ITESTS:-test/*.itest.js}; do n=$(basename $f .itest.js); s=$(date +%s)
   SESSION="stage0 0e full run" tools/test-lock.sh perl -e 'alarm shift; exec @ARGV' 900 node --disable-warning=ExperimentalWarning $f > $OUT/$n.log 2>&1; rc=$?
   ok=$(grep -cE '^ *✓' $OUT/$n.log); [ $rc = 0 ] && [ "$ok" = 0 ] && rc=1 # stage 13, Q13-1: a file where no check passed failed (nokey ran 0/0 as rc=0)
   echo "$n rc=$rc $(( $(date +%s)-s ))s ${ok}✓ $(grep -cE '^ *✗' $OUT/$n.log)✗" >> $OUT/summary.txt
  done
 elif [ $k = ui ]; then
  for f in ${UIS:-test/ui-qa.cjs test/cases-ui.cjs test/extra-ui.cjs test/features-ui.cjs test/house-ui.cjs test/low-ui.cjs test/more-ui.cjs test/r13-ui.cjs test/r15-ui.cjs test/r16-ui.cjs test/r17-ui.cjs test/r18-ui.cjs test/r19-ui.cjs test/r20-ios-ui.cjs test/r20-ios-ui.cjs@webkit test/r21-ui.cjs test/security-ui.cjs test/exits-ui.cjs test/overlap.cjs test/sweep-a.cjs test/sweep-b.cjs test/sweep-c.cjs test/sweep-d.cjs test/a11y-ui.cjs test/stage5-ui.cjs test/stage8-ui.cjs test/stage8-walk-ui.cjs test/stage9-ui.cjs test/stage10-ui.cjs test/stage10-ui.cjs@webkit test/stage11-ui.cjs test/stage11-ui.cjs@webkit test/legal-ui.cjs test/firstuse-ui.cjs test/firstuse-ui.cjs@webkit test/caret-ui.cjs test/caret-ui.cjs@webkit test/search-ui.cjs test/search-ui.cjs@webkit test/home17-ui.cjs test/home17-ui.cjs@webkit test/home18-ui.cjs test/home18-ui.cjs@webkit test/home19-space-ui.cjs test/home19-space-ui.cjs@webkit test/home19-recipes-ui.cjs test/home19-recipes-ui.cjs@webkit test/home19b-space-ui.cjs test/home19b-space-ui.cjs@webkit test/home19-typing-ui.cjs test/home19-typing-ui.cjs@webkit test/home20-week-ui.cjs test/home20-week-ui.cjs@webkit test/home20-tabs-ui.cjs test/home20-tabs-ui.cjs@webkit}; do
   # name@webkit: the same file in Playwright's WebKit (stage 5), the browser under $PW_HOME/browsers, not in /tmp
   n=$(basename ${f%@*} .cjs); s=$(date +%s); BR=chromium; case $f in *@webkit) BR=webkit; n=$n-webkit; f=${f%@*};; esac
   PWB=; [ $BR = webkit ] && PWB=PLAYWRIGHT_BROWSERS_PATH=$PW_HOME/browsers
   env PW_BROWSER=$BR $PWB SESSION="stage0 0e full run" tools/test-lock.sh bash -c '
    f=$1; LOG=$2
    S=/tmp/shuki-test/shuki-uiqa; rm -rf $S; mkdir -p /tmp/shuki-test
    npx wrangler d1 migrations apply shuki --local --persist-to $S >/dev/null 2>&1; npx wrangler d1 execute shuki --local --persist-to $S --file test/fixture-house.sql >/dev/null 2>&1
    npx wrangler d1 execute shuki --local --persist-to $S --command "INSERT INTO pairing_codes (code, user_id, expires) VALUES ('"'"'111111'"'"', 1, 9999999999999), ('"'"'222222'"'"', 2, 9999999999999)" >/dev/null 2>&1
    FAKE_DEBUG=1 PORT=8797 node test/fake-claude.cjs 2>/tmp/shuki-test/fake.log & FAKE=$!
    python3 -c "import os,sys;os.setsid();os.execvp(sys.argv[1],sys.argv[1:])" npx wrangler dev --local --port 8791 --persist-to $S --var ANTHROPIC_URL:http://127.0.0.1:8797/v1/messages --var ANTHROPIC_API_KEY:test --var VAPID_PUBLIC:BMMdXvS-VuZiLvO1dnln5--ThCfc4M25IulaMpiMQcLf_Vr-OuNxtjBm4R-Gl8osOtEdudLwFZ0bBuVCLJwKEo >/tmp/shuki-test/uiqa.log 2>&1 & DEV=$!
    for i in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:8791/ && break; sleep 0.5; done
    perl -e "alarm shift; exec @ARGV" 900 node $f > $LOG 2>&1; RC=$?
    kill $FAKE 2>/dev/null; kill -TERM -$DEV 2>/dev/null; sleep 2; kill -9 -$DEV 2>/dev/null
    exit $RC' _ $f $OUT/$n.log; rc=$?
   echo "$n rc=$rc $(( $(date +%s)-s ))s" >> $OUT/summary.txt
  done
 fi
done
echo DONE >> $OUT/summary.txt
