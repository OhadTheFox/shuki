#!/bin/bash
# ChatGPT against the real model, run on the Mac (the cloud container can't reach api.openai.com).
# Usage, from the repo: bash tools/gpt-check.sh
# It asks for the OpenAI key (not shown, not saved: .dev.vars is deleted when the run ends, even on Ctrl-C),
# runs the round-19 eval and the round-21 recipe evals, and writes the results next to the repo, in ../gpt-results.
set -u
cd "$(dirname "$0")/.."
read -rsp 'OpenAI key: ' K; echo
[ -n "$K" ] || exit 1
trap 'rm -f .dev.vars; lsof -ti tcp:8790 | xargs kill -9 2>/dev/null' EXIT
printf 'OPENAI_API_KEY=%s\n' "$K" > .dev.vars; unset K
[ -d node_modules/wrangler ] || npm install
MODEL=${MODEL:-gpt-5.6-terra}
OUT=../gpt-results; mkdir -p "$OUT"
# which models this key can use (no tokens spent); stop if the one we test isn't there
curl -s https://api.openai.com/v1/models -H "Authorization: Bearer $(sed -n 's/^OPENAI_API_KEY=//p' .dev.vars)" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((j.data||[]).map(m=>m.id).filter(x=>/^(gpt|o\d|chatgpt)/.test(x)).sort().join("\n")||JSON.stringify(j.error||j))}catch{console.log(s.slice(0,300))}})' > "$OUT/models.txt"
if ! grep -qx "$MODEL" "$OUT/models.txt"; then echo "the model $MODEL is not available to this key; see $OUT/models.txt"; exit 1; fi
run() { # eval file, output name, ONLY
  lsof -ti tcp:8790 | xargs kill -9 2>/dev/null
  S=/tmp/shuki-real; rm -rf $S
  npx wrangler d1 migrations apply shuki --local --persist-to $S >/dev/null 2>&1
  npx wrangler d1 execute shuki --local --persist-to $S --file test/fixture-house.sql >/dev/null 2>&1
  npx wrangler d1 execute shuki --local --persist-to $S --command "INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999)" >/dev/null 2>&1
  npx wrangler dev --local --port 8790 --persist-to $S --var PROVIDER:openai --var OPENAI_MODEL:$MODEL >/tmp/shuki-real.log 2>&1 &
  # the first start after an update takes longer; wait up to 2 minutes, and say so if it never came up
  for i in $(seq 1 240); do curl -s -o /dev/null http://127.0.0.1:8790/ && break; sleep 0.5; done
  curl -s -o /dev/null http://127.0.0.1:8790/ || { echo "the local server didn't start; see /tmp/shuki-real.log" | tee "$OUT/$2"; tail -20 /tmp/shuki-real.log >> "$OUT/$2"; return; }
  echo "running $1…"
  ONLY="$3" node "$1" > "$OUT/$2" 2>&1
  npx wrangler d1 execute shuki --local --persist-to $S --command "SELECT * FROM usage" 2>/dev/null | grep -E "input|output" >> "$OUT/$2"
  # the model's own error, whole (it spans several lines in the log)
  grep -iE -A12 "model .* [0-9]{3}:" /tmp/shuki-real.log | head -40 >> "$OUT/$2"
  lsof -ti tcp:8790 | xargs kill -9 2>/dev/null
}
run test/real-r19.eval.js gpt-r19.txt ''
run test/real-r21.eval.js gpt-r21.txt 'TEXT,IDEAS'
echo "done: $(cd "$OUT" && pwd)"
