#!/bin/bash
# UI QA: fresh local DB, fake Claude, wrangler dev, then the phone-sized browser pass.
set -u
cd "$(dirname "$0")/.."
mkdir -p /tmp/shuki-test; S=/tmp/shuki-test/shuki-uiqa; rm -rf $S
npx wrangler d1 migrations apply shuki --local --persist-to $S >/dev/null 2>&1; npx wrangler d1 execute shuki --local --persist-to $S --file test/fixture-house.sql >/dev/null 2>&1
npx wrangler d1 execute shuki --local --persist-to $S --command "INSERT INTO pairing_codes (code, user_id, expires) VALUES ('111111', 1, 9999999999999), ('222222', 2, 9999999999999)" >/dev/null 2>&1
FAKE_DEBUG=1 PORT=8797 node test/fake-claude.cjs 2>/tmp/shuki-test/fake.log & FAKE=$!
setsid npx wrangler dev --local --port 8791 --persist-to $S --var ANTHROPIC_URL:http://127.0.0.1:8797/v1/messages --var ANTHROPIC_API_KEY:test --var VAPID_PUBLIC:BMMdXvS-VuZiLvO1dnln5--ThCfc4M25IulaMpiMQcLf_Vr-OuNxtjBm4R-Gl8osOtEdudLwFZ0bBuVCLJwKEo >/tmp/shuki-test/uiqa.log 2>&1 & DEV=$!
for i in $(seq 1 60); do curl -s -o /dev/null http://127.0.0.1:8791/ && break; sleep 0.5; done
PW=$(npm root -g)/playwright node "${1:-test/ui-qa.cjs}"; RC=$?
kill $FAKE; kill -9 -$DEV 2>/dev/null
exit $RC
