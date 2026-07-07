#!/usr/bin/env bash
set -e

PROJECT="$(cd "$(dirname "$0")" && pwd)"
echo "=== Mythic AI Observatory — Quick Install ==="
echo "Project root: $PROJECT"
echo ""

# ----- Prerequisites -----
echo "--- Checking prerequisites ---"
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 not found"; exit 1; }
command -v pip3 >/dev/null 2>&1 || { echo "ERROR: pip3 not found"; exit 1; }
if command -v pnpm >/dev/null 2>&1; then
  PKG_MGR="pnpm"
elif command -v npm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "pnpm not found — installing via corepack..."
    corepack enable && corepack prepare pnpm@latest --activate
    PKG_MGR="pnpm"
  else
    echo "NOTE: npm found but pnpm is recommended. Using npm."
    PKG_MGR="npm"
  fi
else
  echo "ERROR: Node.js not found (needed for frontend)"
  exit 1
fi
echo "  python3: $(python3 --version)"
echo "  pip3: $(pip3 --version)"
echo "  $PKG_MGR: $($PKG_MGR --version)"
echo ""

# ----- Backend setup -----
echo "--- Setting up backend ---"
cd "$PROJECT/backend"

# Create .env if missing
if [ ! -f .env ]; then
  echo "Creating backend/.env from defaults..."
  cat > .env << 'ENVEOF'
CONDUCTOR_HOST=127.0.0.1
CONDUCTOR_PORT=8001
OLLAMA_MODEL=qwen2.5:3b
ORCHESTRATOR_MODEL=local
CLASSIFIER_MODEL=qwen2.5:1.5b
CLASSIFIER_POLL_INTERVAL=45
EMBEDDING_MODEL=all-minilm:22m
ENVEOF
  echo "  backend/.env created"
else
  echo "  backend/.env exists — skipping"
fi

# Create venv if missing
if [ ! -d .venv ]; then
  echo "Creating Python virtual environment..."
  python3 -m venv .venv
  echo "  .venv created"
fi

echo "Installing Python dependencies..."
source .venv/bin/activate
pip3 install -q -r requirements.txt
deactivate
echo "  done"
echo ""

# ----- Frontend setup -----
echo "--- Setting up frontend ---"
cd "$PROJECT/frontend"

# Create .env.local if missing
if [ ! -f .env.local ]; then
  echo "Creating frontend/.env.local from defaults..."
  cat > .env.local << 'ENVEOF'
NEXT_PUBLIC_API_URL=http://localhost:8001
ALLOWED_ORIGINS=
ENVEOF
  echo "  frontend/.env.local created"
else
  echo "  frontend/.env.local exists — skipping"
fi

if [ ! -d node_modules ]; then
  echo "Installing Node.js dependencies..."
  $PKG_MGR install
  echo "  done"
else
  echo "  node_modules exists — skipping install"
fi
echo ""

# ----- Done -----
echo "=== Install complete ==="
echo ""
echo "To start the backend:  cd $PROJECT/backend && source .venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8001 --reload"
echo "To start the frontend: cd $PROJECT/frontend && $PKG_MGR dev"
echo ""
echo "Or use: bash $PROJECT/restart.sh"
