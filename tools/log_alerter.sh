#!/usr/bin/env bash
# Periodic log health check for Mythic AI Observatory.
# Polls /api/logs/recent and sends Telegram alert if error count
# exceeds thresholds, using the Openclaw Telegram bot token directly.
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8001}"
TELEGRAM_TARGET="${TELEGRAM_TARGET:-8691064410}"
BOT_TOKEN="${BOT_TOKEN:-TELEGRAM_BOT_TOKEN_REDACTED}"

data=$(curl -s --max-time 10 "${API_BASE}/api/logs/recent?since=300" 2>/dev/null)
err5=$(echo "$data" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['errors_last_5m'])" 2>/dev/null || echo "0")
warn5=$(echo "$data" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['warnings_last_5m'])" 2>/dev/null || echo "0")
err24=$(echo "$data" | python3 -c "import sys,json; print(json.load(sys.stdin)['summary']['errors_24h'])" 2>/dev/null || echo "0")

if [ "$err5" -gt 0 ] || [ "$warn5" -gt 5 ]; then
  errors=$(echo "$data" | python3 -c "
import sys,json
d=json.load(sys.stdin)
msgs = [e['msg'][:120] for e in d['entries'] if e.get('level')=='ERROR']
print('\\n'.join(msgs[:3]) if msgs else '(no error details)')
" 2>/dev/null || echo "(could not parse)")

  msg="⚠️  Log Alert — Mythic Observatory
• ${err5} errors, ${warn5} warnings (5m)
• ${err24} errors in 24h

${errors}"

  curl -s --max-time 10 \
    "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${TELEGRAM_TARGET}" \
    -d "text=${msg}" \
    -d "disable_notification=true" > /dev/null
fi
