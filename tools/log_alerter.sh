#!/usr/bin/env bash
# Periodic log health check for Mythic AI Observatory.
# Polls /api/logs/recent and sends Telegram alert if error count
# exceeds thresholds.
#
# Required env vars (or ~/.config/mythic/log_alerter.env):
#   BOT_TOKEN        — Telegram bot token
#   TELEGRAM_TARGET  — Telegram chat ID to send alerts to
# Optional:
#   API_BASE         — Observatory backend URL (default: http://127.0.0.1:8001)
set -euo pipefail

CONFIG_FILE="${HOME}/.config/mythic/log_alerter.env"
if [ -f "$CONFIG_FILE" ]; then
  set -a; source "$CONFIG_FILE"; set +a
fi

API_BASE="${API_BASE:-http://127.0.0.1:8001}"

if [ -z "${BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_TARGET:-}" ]; then
  echo "log_alerter: BOT_TOKEN and TELEGRAM_TARGET must be set"
  echo "  either as env vars or in ${CONFIG_FILE}"
  echo "  See tools/log_alerter.env.example"
  exit 1
fi

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
