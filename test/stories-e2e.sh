#!/bin/bash
# Round 20: the user stories (test/stories/r20.json) through the app, against the real model, then a separate judge
# and the Hebrew reviewer. Each story on its own empty server. Needs ANTHROPIC_API_KEY in .dev.vars. Costs dollars.
# Run: bash test/stories-e2e.sh [S01,S05]   Results: /tmp/shuki-test/stories/results.json and each story's folder.
cd "$(dirname "$0")/.."
bash test/killservers.sh
ONLY="$1" PW=$(npm root -g)/playwright timeout 7200 node test/stories-e2e.cjs; RC=$?
bash test/killservers.sh
node test/hebrew-review.mjs /tmp/shuki-test/stories/all-shuki-lines.txt /tmp/shuki-test/stories/hebrew.json
exit $RC
