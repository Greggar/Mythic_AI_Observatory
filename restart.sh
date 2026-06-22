#!/usr/bin/env bash
set -e
PROJECT="$(cd "$(dirname "$0")" && pwd)"

pkill -f "next-server" 2>/dev/null || true
pkill -f "uvicorn" 2>/dev/null || true
sleep 1

# Load env defaults
if [ -f "$PROJECT/backend/.env" ]; then
  export $(grep -v '^\s*#' "$PROJECT/backend/.env" | xargs)
fi
BACKEND_PORT="${CONDUCTOR_PORT:-8001}"
FRONTEND_PORT="${FRONTEND_PORT:-3001}"

cd "$PROJECT/backend"
echo "Starting backend..."

# Resolve uvicorn binary: env override → venv candidates → system PATH
if [ -n "$UVICORN_BIN" ]; then
  UVICORN="$UVICORN_BIN"
elif [ -x ".venv/bin/uvicorn" ]; then
  UVICORN=".venv/bin/uvicorn"
elif [ -x "venv/bin/uvicorn" ]; then
  UVICORN="venv/bin/uvicorn"
elif command -v uvicorn &>/dev/null; then
  UVICORN="uvicorn"
else
  echo "ERROR: uvicorn not found. Set UVICORN_BIN or create a venv." >&2
  exit 1
fi

setsid "$UVICORN" main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload > "$PROJECT/logs/backend.log" 2>&1 &
disown
sleep 2

cd "$PROJECT/frontend"
echo "Starting frontend..."
setsid pnpm dev --port "$FRONTEND_PORT" > "$PROJECT/logs/frontend.log" 2>&1 &
disown

echo "Done. Backend :$BACKEND_PORT | Frontend :$FRONTEND_PORT"
