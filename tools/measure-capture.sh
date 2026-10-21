#!/bin/bash
# Stage 0: one message to the fixed house (test/measure-house.mjs) through the real server, with a fake model that
# saves the request the server would send to Claude. Fake model only: no key, no cost.
# Run under the test lock (always -k):  lockf -k /tmp/shuki-test.lock bash tools/measure-capture.sh "<message>" [avi|michal|yoavi]
# The phones are already paired in the fixed house (test tokens from TOKENS in test/measure-house.mjs). Output in /tmp/shuki-measure/out.
set -eo pipefail
cd "$(dirname "$0")/.."
MSG=${1:?message}; WHO=${2:-avi}
S=/tmp/shuki-measure; OUT=$S/out; PORT=8780; MOCK=8781
NOW=1791298800000   # Tue 06/10/2026 18:00 Asia/Jerusalem, the same as in test/measure-house.mjs
rm -rf $S; mkdir -p $OUT
node test/measure-house.mjs $S/house.sql >/dev/null
npx wrangler d1 migrations apply shuki --local --persist-to $S/db >/dev/null 2>&1
npx wrangler d1 execute shuki --local --persist-to $S/db --file $S/house.sql >/dev/null 2>&1
# the fake model: saves each request and answers with an empty respond
OUT=$OUT PORT=$MOCK node -e '
const http = require("http"), fs = require("fs"); let n = 0;
http.createServer((req, res) => { const parts = []; req.on("data", (c) => parts.push(c)); req.on("end", () => { const b = Buffer.concat(parts).toString("utf8");
  fs.writeFileSync(`${process.env.OUT}/request-${++n}.json`, b);
  const tool = JSON.parse(b).tools?.[0]?.name || "respond";
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ content: [{ type: "tool_use", name: tool, input: { reply: "אני פה!", face: "happy" } }], usage: { input_tokens: 0, output_tokens: 0 } }));
}); }).listen(+process.env.PORT);' & MPID=$!
npx wrangler dev --local --port $PORT --persist-to $S/db --var ANTHROPIC_URL:http://127.0.0.1:$MOCK/v1/messages --var ANTHROPIC_API_KEY:mock --var FIXED_NOW:$NOW --var CHAT_PER_MINUTE:1000 >$S/dev.log 2>&1 & DPID=$!
trap 'kill $MPID $DPID 2>/dev/null; pkill -f "wrangler dev --local --port $PORT" 2>/dev/null; pkill -f "workerd.*$PORT" 2>/dev/null; true' EXIT
for i in $(seq 1 80); do curl -s -o /dev/null http://127.0.0.1:$PORT/ && break; sleep 0.5; done
TOKEN=$(WHO=$WHO node --input-type=module -e "const { TOKENS } = await import('./test/measure-house.mjs'); process.stdout.write(TOKENS[process.env.WHO] || '')")
MSG="$MSG" node -e 'process.stdout.write(JSON.stringify({ text: process.env.MSG }))' > $S/body.json
curl -s -X POST http://127.0.0.1:$PORT/api/chat -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" --data-binary @$S/body.json > $OUT/reply.json
# what was sent: the size of each part, and the variable block as text
OUT=$OUT node -e '
const fs = require("fs"); const f = fs.readdirSync(process.env.OUT).filter((x) => x.startsWith("request-")).sort().at(-1);
if (!f) { console.log("no request reached the fake model"); process.exit(1); }
const r = JSON.parse(fs.readFileSync(`${process.env.OUT}/${f}`, "utf8"));
const len = (x) => JSON.stringify(x).length;
console.log("tools:", len(r.tools), "chars; system:", r.system.map((b) => `${b.text.length} chars${b.cache_control ? " (cache)" : ""}`).join(" + "), "; messages:", r.messages.length, "/", len(r.messages), "chars");
fs.writeFileSync(`${process.env.OUT}/block.txt`, r.system.slice(1).map((b, k) => `=== part ${k + 2}${b.cache_control ? " (cache)" : ""} ===\n${b.text}`).join("\n\n")); // 0e: parts 2–4
fs.writeFileSync(`${process.env.OUT}/messages.json`, JSON.stringify(r.messages, null, 1));'
