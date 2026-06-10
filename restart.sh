#!/usr/bin/env bash
set -e
PROJECT="$(cd "$(dirname "$0")" && pwd)"

pkill -f "next-server" 2>/dev/null || true
pkill -f "uvicorn" 2>/dev/null || true
sleep 1

cd "$PROJECT/backend"
echo "Starting backend..."
setsid .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8001 --reload > "$PROJECT/logs/backend.log" 2>&1 &
disown
sleep 2

cd "$PROJECT/frontend"
echo "Starting frontend..."
setsid pnpm dev --port 3001 > "$PROJECT/logs/frontend.log" 2>&1 &
disown

echo "Done. Backend :8001 | Frontend :3001"
