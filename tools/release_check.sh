#!/usr/bin/env bash
#
# Unified pre-release verification gate for the Mythic AI Observatory.
# Runs the full backend + frontend check chain in order, failing fast.
#
# Use:  ./tools/release_check.sh            # all checks
#       ./tools/release_check.sh backend    # backend only
#       ./tools/release_check.sh frontend   # frontend only
#
# Mirrors the "Standing verification rule" in DEVELOPMENT.md §3 / AGENTS.md.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-all}"
FAIL=0

# Backend test runner: prefer the local venv, else whatever `pytest` is on PATH
# (lets the same script run under CI where the venv isn't checked out).
BE_PYTEST="$(command -v pytest >/dev/null 2>&1 && echo pytest || true)"
if [ -x "$ROOT/backend/.venv/bin/pytest" ]; then
  BE_PYTEST="$ROOT/backend/.venv/bin/pytest"
fi
BE_RUFF="$(command -v ruff >/dev/null 2>&1 && echo ruff || true)"
if [ -x "$ROOT/backend/.venv/bin/ruff" ]; then
  BE_RUFF="$ROOT/backend/.venv/bin/ruff"
fi

run() {
  local label="$1"; shift
  printf '\n=== %s ===\n' "$label"
  "$@"
}

step_backend() {
  run "backend: pytest (unit + API)" bash -lc \
    "cd '$ROOT/backend' && $BE_PYTEST -q"
  local rc=$?
  [ $rc -ne 0 ] && FAIL=1
  [ $rc -eq 0 ] && echo "OK: backend pytest"

  if [ -n "$BE_RUFF" ]; then
    run "backend: ruff check" bash -lc \
      "cd '$ROOT/backend' && $BE_RUFF check ."
    rc=$?
    [ $rc -ne 0 ] && FAIL=1
    [ $rc -eq 0 ] && echo "OK: backend ruff"
  else
    echo "note: ruff not installed (skipping; backend gate = pytest)"
  fi
}

step_frontend() {
  run "frontend: typecheck (tsc --noEmit)" bash -lc \
    "cd '$ROOT/frontend' && npx tsc --noEmit"
  local rc=$?
  [ $rc -ne 0 ] && FAIL=1
  [ $rc -eq 0 ] && echo "OK: frontend tsc"

  run "frontend: unit tests (vitest)" bash -lc \
    "cd '$ROOT/frontend' && pnpm test"
  rc=$?
  [ $rc -ne 0 ] && FAIL=1
  [ $rc -eq 0 ] && echo "OK: frontend vitest"

  run "frontend: lint (eslint)" bash -lc \
    "cd '$ROOT/frontend' && pnpm lint" || true
  echo "note: eslint is a tracked budget (97, Phase 22 deferred debt) — reported, not failing this gate"

  run "frontend: production build" bash -lc \
    "cd '$ROOT/frontend' && pnpm build"
  rc=$?
  [ $rc -ne 0 ] && FAIL=1
  [ $rc -eq 0 ] && echo "OK: frontend build"
}

case "$MODE" in
  backend)  step_backend ;;
  frontend) step_frontend ;;
  all)      step_backend ; step_frontend ;;
  *)
    echo "usage: $0 [backend|frontend|all]" >&2
    exit 2
    ;;
esac

printf '\n'
if [ "$FAIL" -eq 0 ]; then
  echo "✓ release_check: ALL CHECKS PASSED"
else
  echo "✗ release_check: FAILURES ABOVE — do not release" >&2
  exit 1
fi
