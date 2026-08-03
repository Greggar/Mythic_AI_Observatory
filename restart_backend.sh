#!/usr/bin/env bash
set -e
PROJECT="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$PROJECT/logs"

pkill -f "uvicorn" 2>/dev/null || true
sleep 1

if [ -f "$PROJECT/backend/.env" ]; then
  set -a
  source "$PROJECT/backend/.env"
  set +a
fi
BACKEND_PORT="${CONDUCTOR_PORT:-8001}"

cd "$PROJECT/backend"
if [ -x ".venv/bin/uvicorn" ]; then
  UVICORN=".venv/bin/uvicorn"
else
  UVICORN="$(command -v uvicorn)"
fi

setsid "$UVICORN" main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload > "$PROJECT/logs/backend.log" 2>&1 &
disown

echo "Backend starting on :$BACKEND_PORT"
