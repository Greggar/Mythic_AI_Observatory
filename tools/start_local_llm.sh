#!/usr/bin/env bash
# Local logprobs-capable LLM node (llama.cpp-server) for qwen2.5:3b.
# OpenAI-compatible /v1/chat/completions with top-k logprobs → feeds the
# Observatory's token-entropy signal on the primary node.
#
# Binaries + GGUF live outside the repo by default: ~/llama-cpp/
#   llama-b10240/llama-server          (llama.cpp prebuilt b10240)
#   qwen2.5-3b-instruct-Q4_K_M.gguf    (bartowski Q4_K_M, ~1.9 GB)
# Override with LLAMA_CPP_DIR.
set -e
DIR="${LLAMA_CPP_DIR:-$HOME/llama-cpp}"
PORT="${LOCAL_LLM_PORT:-12435}"
BIN="$DIR/llama-b10240/llama-server"
MODEL="$DIR/qwen2.5-3b-instruct-Q4_K_M.gguf"

if [ ! -x "$BIN" ]; then
  echo "llama-server not found at $BIN (set LLAMA_CPP_DIR)" >&2
  exit 1
fi

pkill -f "llama-b10240/llama-server" 2>/dev/null || true
sleep 1

setsid "$BIN" \
  -m "$MODEL" \
  --host 127.0.0.1 \
  --port "$PORT" \
  --ctx-size 8192 \
  --jinja \
  --n-gpu-layers 0 \
  --threads 8 \
  --parallel 1 \
  > "$DIR/local_llm.log" 2>&1 &

disown
echo "local_llm starting on 127.0.0.1:$PORT (log: $DIR/local_llm.log)"
