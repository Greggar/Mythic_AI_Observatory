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

# ----- Detect Ollama models -----
echo "--- Detecting Ollama models ---"
OLLAMA_FOUND=""
OLLAMA_MODELS=""
OLLAMA_URL=""

# 1) Try native Ollama binary
if command -v ollama >/dev/null 2>&1 && ollama list >/dev/null 2>&1; then
  OLLAMA_FOUND=true
  OLLAMA_URL="http://127.0.0.1:11434"
  OLLAMA_MODELS=$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}')
  echo "  Found native Ollama"
  echo "  Available models:"
  echo "$OLLAMA_MODELS" | sed 's/^/    /'
  echo ""
# 2) Fallback: check if Ollama API is running in Docker (port 11434)
elif curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  OLLAMA_FOUND=true
  OLLAMA_URL="http://127.0.0.1:11434"
  OLLAMA_MODELS=$(curl -sf http://127.0.0.1:11434/api/tags | python3 -c "import sys,json; print('\n'.join(m['name'] for m in json.load(sys.stdin).get('models',[])))" 2>/dev/null || true)
  echo "  Found Ollama-compatible API on port 11434 (Docker?)"
  echo "  Available models:"
  echo "$OLLAMA_MODELS" | sed 's/^/    /'
  echo ""
# 3) Check Docker Model Runner on port 12434
elif curl -sf http://127.0.0.1:12434/api/tags >/dev/null 2>&1; then
  OLLAMA_FOUND=true
  OLLAMA_URL="http://127.0.0.1:12434"
  OLLAMA_MODELS=$(curl -sf http://127.0.0.1:12434/api/tags | python3 -c "import sys,json; print('\n'.join(m['name'] for m in json.load(sys.stdin).get('models',[])))" 2>/dev/null || true)
  echo "  Found Docker Model Runner on port 12434"
  echo "  Available models:"
  echo "$OLLAMA_MODELS" | sed 's/^/    /'
  echo ""
else
  echo "  No Ollama or Docker Model Runner detected on standard ports"
  echo "  Will use default model names — update .env after install"
  echo ""
fi

# Pick main model: prefer qwen2.5 3-7B, then any qwen2.5, then first available
pick_main_model() {
  if [ -z "$OLLAMA_FOUND" ]; then
    echo "qwen2.5:3b"
    return
  fi
  # Prefer qwen2.5 variants in 3-7B range
  local candidate
  candidate=$(echo "$OLLAMA_MODELS" | grep -E '^qwen2\.5:(3b|7b|14b)' | head -1)
  if [ -n "$candidate" ]; then
    echo "$candidate"
    return
  fi
  # Any qwen2.5 model
  candidate=$(echo "$OLLAMA_MODELS" | grep '^qwen2.5' | head -1)
  if [ -n "$candidate" ]; then
    echo "$candidate"
    return
  fi
  # Any chat model (avoid embedding/classification-only models)
  candidate=$(echo "$OLLAMA_MODELS" | grep -vE '^all-minilm' | head -1)
  if [ -n "$candidate" ]; then
    echo "$candidate"
    return
  fi
  echo "qwen2.5:3b"
}

# Pick classifier: prefer 1.5b, then smallest qwen, then smallest model
pick_classifier_model() {
  if [ -z "$OLLAMA_FOUND" ]; then
    echo "qwen2.5:1.5b"
    return
  fi
  local candidate
  candidate=$(echo "$OLLAMA_MODELS" | grep '^qwen2.5:1\.5b' | head -1)
  if [ -n "$candidate" ]; then
    echo "$candidate"
    return
  fi
  candidate=$(echo "$OLLAMA_MODELS" | grep '^qwen2.5' | sort -V | head -1)
  if [ -n "$candidate" ]; then
    echo "$candidate"
    return
  fi
  echo "$OLLAMA_MODELS" | grep -vE '^all-minilm' | head -1 || echo "qwen2.5:1.5b"
}

# Pick embedding model: prefer all-minilm
pick_embedding_model() {
  if [ -z "$OLLAMA_FOUND" ]; then
    echo "all-minilm:22m"
    return
  fi
  local candidate
  candidate=$(echo "$OLLAMA_MODELS" | grep '^all-minilm' | head -1)
  if [ -n "$candidate" ]; then
    echo "$candidate"
    return
  fi
  echo "all-minilm:22m"
}

MAIN_MODEL=$(pick_main_model)
CLASSIFIER_MODEL=$(pick_classifier_model)
EMBEDDING_MODEL=$(pick_embedding_model)

echo "  Selected for main model:    $MAIN_MODEL"
echo "  Selected for classifier:    $CLASSIFIER_MODEL"
echo "  Selected for embeddings:    $EMBEDDING_MODEL"
echo ""

# Validate models with a quick generation test
if [ -n "$OLLAMA_FOUND" ]; then
  echo "--- Validating models ---"
  validate_model() {
    local model="$1" url="$2" label="$3"
    # Quick timeout: if model can't respond in 15s, it's likely too large
    resp=$(curl -sf --max-time 15 "${url}/api/generate" -d "{\"model\":\"${model}\",\"prompt\":\"hi\",\"stream\":false}" 2>/dev/null || echo '{"error":"timeout"}')
    if echo "$resp" | grep -q '"error"'; then
      echo "  WARNING: $label ($model) may be too large or unavailable — try a smaller model"
      return 1
    else
      echo "  OK: $label ($model) responded"
      return 0
    fi
  }
  # Use OLLAMA_URL if set, otherwise default to 11434
  _probe_url="${OLLAMA_URL:-http://127.0.0.1:11434}"
  validate_model "$MAIN_MODEL" "$_probe_url" "Main model"
  validate_model "$CLASSIFIER_MODEL" "$_probe_url" "Classifier"
  echo ""
fi

# ----- Backend setup -----
echo "--- Setting up backend ---"
cd "$PROJECT/backend"

# Create .env if missing
if [ ! -f .env ]; then
  echo "Creating backend/.env..."
  cat > .env << ENVEOF
# Backend server binding
CONDUCTOR_HOST=127.0.0.1
CONDUCTOR_PORT=8001

# Local (CPU) inference model — edit to match your Ollama setup
OLLAMA_MODEL=${MAIN_MODEL}

# Orchestrator provider: "local" or "worker"
ORCHESTRATOR_MODEL=local

# Background synesthesia classifier — use a small, fast model
CLASSIFIER_MODEL=${CLASSIFIER_MODEL}
CLASSIFIER_POLL_INTERVAL=45

# Embedding model for DDC/LCC
EMBEDDING_MODEL=${EMBEDDING_MODEL}
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

# ----- Verify models -----
if [ -n "$OLLAMA_FOUND" ]; then
  echo "--- Verifying models ---"
  MISSING=""
  for m in "$MAIN_MODEL" "$CLASSIFIER_MODEL" "$EMBEDDING_MODEL"; do
    if ! echo "$OLLAMA_MODELS" | grep -qF "$m"; then
      MISSING="$MISSING $m"
    fi
  done
  if [ -n "$MISSING" ]; then
    echo "  WARNING: Models not found locally:$MISSING"
    echo "  Pull them with: ollama pull <model>"
  else
    echo "  All selected models available"
  fi
  echo ""
fi

# ----- Done -----
echo "=== Install complete ==="
echo ""
echo "To start the backend:  cd $PROJECT/backend && source .venv/bin/activate && uvicorn main:app --host 0.0.0.0 --port 8001 --reload"
echo "To start the frontend: cd $PROJECT/frontend && $PKG_MGR dev"
echo ""
echo "Or use: bash $PROJECT/restart.sh"
