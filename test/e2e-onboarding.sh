#!/bin/bash
# The first meeting, end to end, against the real model: an empty server, setting up the house in the app,
# "בוא נכיר!", every question, and mapping to the end. Screenshots in /tmp/shuki-test/e2e. Costs a few cents.
# Needs ANTHROPIC_API_KEY in .dev.vars. Run: bash test/e2e-onboarding.sh
cd "$(dirname "$0")/.."
bash test/killservers.sh
S=/tmp/shuki-test/shuki-e2e; rm -rf $S; mkdir -p /tmp/shuki-test/e2e
npx wrangler d1 migrations apply shuki --local --persist-to $S >/dev/null 2>&1
(setsid npx wrangler dev --local --port 8779 --persist-to $S --var SETUP_CODE:24681357 --var MODEL:claude-sonnet-5 >/tmp/shuki-test/e2e/server.log 2>&1 &)
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8779/ && break; sleep 0.5; done
PW=$(npm root -g)/playwright timeout 600 node test/e2e-onboarding.cjs; RC=$?
bash test/killservers.sh
exit $RC
