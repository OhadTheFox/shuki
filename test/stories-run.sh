#!/bin/bash
# The independent scenarios against the real model, split over N local servers (each its own DB). Usage: bash test/stories-run.sh [N=6] [S01 S02 ...]
cd "$(dirname "$0")/.."
N=${1:-6}; shift; mkdir -p /tmp/shuki-test
bash test/killservers.sh; sleep 1
rm -f /tmp/shuki-test/stories-*.json /tmp/shuki-test/stories-log-*.txt
for k in $(seq 0 $((N-1))); do
  S=/tmp/shuki-stories-$k; rm -rf $S
  npx wrangler d1 migrations apply shuki --local --persist-to $S >/dev/null 2>&1; npx wrangler d1 execute shuki --local --persist-to $S --file test/fixture-house.sql >/dev/null 2>&1
  npx wrangler d1 execute shuki --local --persist-to $S --command "INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999)" >/dev/null 2>&1
  (setsid npx wrangler dev --local --port $((8800+k)) --inspector-port $((9300+k)) --persist-to $S --var MODEL:claude-sonnet-5 --var TEST_RESET:1 >/tmp/shuki-stories-$k.log 2>&1 &)
done
for k in $(seq 0 $((N-1))); do for i in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:$((8800+k))/ && break; sleep 0.5; done; done
for k in $(seq 0 $((N-1))); do PORT=$((8800+k)) SHARD=$k/$N node test/stories-run.mjs "$@" > /tmp/shuki-test/stories-log-$k.txt 2>&1 & done
wait
OUT=${OUT:-test/stories-results.json} node -e "const fs=require('fs');const all=[];for(let k=0;k<$N;k++){try{all.push(...JSON.parse(fs.readFileSync('/tmp/shuki-test/stories-'+k+'.json','utf8')))}catch{}};all.sort((a,b)=>+a.id.slice(1)-+b.id.slice(1));fs.writeFileSync(process.env.OUT||'test/stories-results.json',JSON.stringify(all,null,1));const c=v=>all.filter(r=>r.verdict===v).length;console.log('pass',c('pass'),'fail',c('fail'),'missing-feature',c('missing-feature'),'error',c('error'),'/',all.length)"
bash test/killservers.sh
