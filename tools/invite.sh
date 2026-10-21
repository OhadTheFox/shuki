#!/bin/bash
# A one-time pairing code (7 days) for the phone of someone in the house: ./tools/invite.sh <name>
# (the admin can also make one in the app: Settings, the house)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -n "${1:-}" ] || { echo "שימוש: ./tools/invite.sh <שם של מישהו מבני הבית>"; exit 1; }
NAME="${1//\'/}"
U=$(npx --yes wrangler@4 d1 execute shuki --remote --json --command "SELECT id FROM users WHERE name = '$NAME' AND active = 1" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const r=JSON.parse(s.slice(s.indexOf('[')))[0].results;process.stdout.write(r.length?String(r[0].id):'')})")
[ -n "$U" ] || { echo "אין בבית מישהו בשם $1"; exit 1; }
CODE=$(LC_ALL=C tr -dc '0-9' < /dev/urandom | head -c 6)
EXP=$(( ($(date +%s) + 7*86400) * 1000 ))
npx --yes wrangler@4 d1 execute shuki --remote --command "INSERT INTO pairing_codes (code, user_id, expires) VALUES ('$CODE', $U, $EXP)" >/dev/null
echo "קוד הצימוד של $1: $CODE  (תקף 7 ימים, פעם אחת)"
