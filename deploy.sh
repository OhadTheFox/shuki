#!/bin/bash
# Deploy to Cloudflare in one command: ./deploy.sh
# The first time: log in, create the database (D1), push keys, and Shuki's model API key.
set -euo pipefail
cd "$(dirname "$0")"
W="npx --yes wrangler@4"

if ! $W whoami 2>&1 | grep -q "You are logged in"; then
  echo "→ התחברות ל-Cloudflare (ייפתח דפדפן)"
  $W login
fi

if grep -q REPLACE_D1_ID wrangler.toml; then
  echo "→ יוצר מסד נתונים shuki"
  ID=$($W d1 create shuki 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  [ -n "$ID" ] || { echo "✗ יצירת D1 נכשלה"; exit 1; }
  sed -i.bak "s/REPLACE_D1_ID/$ID/" wrangler.toml && rm wrangler.toml.bak
fi

if grep -q REPLACE_VAPID_PUBLIC wrangler.toml; then
  echo "→ יוצר מפתחות להתראות"
  PUB=$(node tools/vapid.mjs)
  sed -i.bak "s/REPLACE_VAPID_PUBLIC/$PUB/" wrangler.toml && rm wrangler.toml.bak
fi

echo "→ מעדכן את מבנה מסד הנתונים"
$W d1 migrations apply shuki --remote

echo "→ מעלה"
$W deploy

if [ -f .vapid-private.json ] && ! $W secret list 2>/dev/null | grep -q VAPID_PRIVATE_JWK; then
  echo "→ שומר את מפתח ההתראות כסוד בשרת"
  $W secret put VAPID_PRIVATE_JWK < .vapid-private.json
fi

if ! $W secret list 2>/dev/null | grep -qE "ANTHROPIC_API_KEY|OPENAI_API_KEY"; then
  echo
  echo "→ המוח של שוקי: מפתח API של Claude (console.anthropic.com) או של ChatGPT (platform.openai.com)."
  echo "  מומלץ להגדיר שם תקרת הוצאה חודשית. Enter ריק = לדלג (מזינים את המפתח באפליקציה, בהקמת הבית)."
  KEY=$(grep -s -E '^(ANTHROPIC|OPENAI)_API_KEY=' .dev.vars | head -1 | cut -d= -f2- || true)
  if [ -n "$KEY" ]; then echo "  נמצא ב-.dev.vars"; else read -r -s -p "  מפתח: " KEY; echo; fi
  case "$KEY" in
    sk-ant-*) printf '%s' "$KEY" | $W secret put ANTHROPIC_API_KEY ;;
    sk-*) printf '%s' "$KEY" | $W secret put OPENAI_API_KEY ;;
  esac
fi

echo "✓ הושלם. הכתובת מופיעה למעלה (מסתיימת ב-workers.dev)."
echo "  קוד צימוד לבן בית:   ./tools/invite.sh <שם>"
