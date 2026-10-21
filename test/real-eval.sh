#!/bin/bash
# usage: real-eval.sh <model> <outfile> [eval file]   (claude-sonnet-5, or gpt-5.6-terra for ChatGPT)
cd "$(dirname "$0")/.."
ps -eo pid,args | grep -E "[w]orkerd|[w]rangler dev|[w]rangler-dist/cli.js dev|[e]sbuild --service" | awk '{print $1}' | xargs -r kill -9 2>/dev/null
S=/tmp/shuki-real; rm -rf $S
npx wrangler d1 migrations apply shuki --local --persist-to $S >/dev/null 2>&1; npx wrangler d1 execute shuki --local --persist-to $S --file test/fixture-house.sql >/dev/null 2>&1
npx wrangler d1 execute shuki --local --persist-to $S --command "INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999)" >/dev/null 2>&1
# a model name starting with gpt- runs ChatGPT (OPENAI_API_KEY in .dev.vars); anything else is Claude
case "$1" in gpt-*) VARS="--var PROVIDER:openai --var OPENAI_MODEL:$1" ;; *) VARS="--var MODEL:$1" ;; esac
(setsid npx wrangler dev --local --port 8790 --persist-to $S $VARS >/tmp/shuki-real.log 2>&1 &)
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8790/ && break; sleep 0.5; done
timeout 400 env ONLY="$ONLY" node ${3:-test/real-model.eval.js} > $2 2>&1
# each eval writes its own results file; only the default one is copied next to the output (round 20: this used to
# copy real-model-results.json over every round's results)
[ -z "$3" ] && cp test/real-model-results.json ${2%.txt}.json 2>/dev/null
npx wrangler d1 execute shuki --local --persist-to $S --command "SELECT * FROM usage" 2>/dev/null | grep -E "input|output" >> $2
