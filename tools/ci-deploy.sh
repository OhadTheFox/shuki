#!/bin/bash
# Run by .github/workflows/deploy.yml on GitHub. Creates what's missing (D1, secrets), migrates, deploys.
# INVITE=<a name from the house> makes a one-time pairing code (printed only in a private repo).
set -eo pipefail
W="npx wrangler"
# a fork (or a copy) without Cloudflare secrets: nothing to deploy to, and that's fine
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then echo "::notice title=Not deployed::No CLOUDFLARE_API_TOKEN secret in this repository."; exit 0; fi
# is the token good? (quietly: "wrangler whoami" prints the account's e-mail, and logs of a public repo are public)
$W whoami >/dev/null 2>&1 || { echo "the Cloudflare token doesn't work (CLOUDFLARE_API_TOKEN)"; exit 1; }

list_id() { $W d1 list --json 2>&1 | tee /tmp/d1err | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const d=JSON.parse(s).find(x=>x.name==='shuki');process.stdout.write(d?d.uuid:'')}catch(e){process.exit(3)}})"; }
ID=$(list_id) || { echo "d1 list failed:"; cat /tmp/d1err; exit 1; }
if [ -z "$ID" ]; then $W d1 create shuki >/dev/null; ID=$(list_id); fi
[ -n "$ID" ] || { echo "no D1 id"; exit 1; }
sed -i "s/REPLACE_D1_ID/$ID/" wrangler.toml

$W d1 migrations apply shuki --remote
$W deploy > /tmp/deploy.txt 2>&1 || { cat /tmp/deploy.txt; exit 1; }
URL=$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' /tmp/deploy.txt | head -1 || true)

# optional: without them the Claude key is entered in the app, and push keys are made by the server itself
HAVE=$($W secret list 2>/dev/null || true)
if [ -n "$ANTHROPIC_API_KEY" ]; then echo "$HAVE" | grep -q ANTHROPIC_API_KEY || printf '%s' "$ANTHROPIC_API_KEY" | $W secret put ANTHROPIC_API_KEY; fi
if [ -n "$OPENAI_API_KEY" ]; then echo "$HAVE" | grep -q OPENAI_API_KEY || printf '%s' "$OPENAI_API_KEY" | $W secret put OPENAI_API_KEY; fi
if [ -n "$VAPID_PRIVATE_JWK" ]; then echo "$HAVE" | grep -q VAPID_PRIVATE_JWK || printf '%s' "$VAPID_PRIVATE_JWK" | $W secret put VAPID_PRIVATE_JWK; fi

q() { $W d1 execute shuki --remote --json --command "$1" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s.slice(s.indexOf('[')))[0].results;process.stdout.write(r.length?String(Object.values(r[0])[0]):'')})"; }
# Codes are printed only when the repository is private: the logs of a public repo (or fork) are public,
# and whoever reads a setup code first becomes the admin. In a public repo, set SETUP_CODE as a secret instead.
PRIVATE=$(node -e "try{console.log(require(process.env.GITHUB_EVENT_PATH).repository.private===true?'yes':'')}catch{console.log('')}")
# the address, like the codes, only where the logs are private (a public log would point at the live install)
if [ -n "$URL" ]; then if [ -n "$PRIVATE" ]; then echo "::notice title=שוקי באוויר::$URL"; else echo "::notice title=Deployed::The address is in the Cloudflare dashboard (Workers)."; fi; fi
# a new house: a one-time setup code, for whoever opens the app first with it
if [ -z "$(q "SELECT id FROM users WHERE active = 1 LIMIT 1")" ]; then
  CODE=$(q "SELECT value FROM settings WHERE key = 'setup_code'")
  if [ -n "$SETUP_CODE" ]; then CODE=$(echo "$SETUP_CODE" | tr -cd '0-9'); fi
  if [ -z "$CODE" ]; then CODE=$(node -e "console.log(String(require('crypto').randomInt(10000000,100000000)))"); fi
  $W d1 execute shuki --remote --command "INSERT OR REPLACE INTO settings (key, value) VALUES ('setup_code', '$CODE')" >/dev/null
  if [ -n "$PRIVATE" ]; then echo "::notice title=Setup code for a new house::$CODE"
  else echo "::notice title=Setup code::Not printed (public repository). Set the SETUP_CODE secret, or read it with: wrangler d1 execute shuki --remote --command \"SELECT value FROM settings WHERE key='setup_code'\""; fi
fi

# INVITE=<name of someone in the house>: a one-time pairing code for them (the admin can also make one in the app)
if [ -n "$INVITE" ]; then
  U=$(q "SELECT id FROM users WHERE name = '${INVITE//\'/}' AND active = 1")
  [ -n "$U" ] || { echo "invite: אין בבית מישהו בשם $INVITE"; exit 1; }
  CODE=$(node -e "console.log(String(require('crypto').randomInt(100000,1000000)))")
  EXP=$(( ($(date +%s) + 7*86400) * 1000 ))
  $W d1 execute shuki --remote --command "INSERT INTO pairing_codes (code, user_id, expires) VALUES ('$CODE', $U, $EXP)" >/dev/null
  if [ -n "$PRIVATE" ]; then echo "::notice title=Pairing code for $INVITE::$CODE (7 days, once)"; else echo "::notice title=Pairing code::Not printed (public repository). The admin makes one in the app: Settings, the house."; fi
fi
