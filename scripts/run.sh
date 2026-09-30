#!/usr/bin/env bash
# neural-brain · start backend (:8000) + frontend (:5173). Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

[ -d backend/.venv ] || { echo "Run ./scripts/setup.sh first"; exit 1; }
[ -d frontend/node_modules ] || { echo "Run ./scripts/setup.sh first"; exit 1; }

pids=()
cleanup() { echo; echo "▸ shutting down"; kill "${pids[@]}" 2>/dev/null || true; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# backend runs as a package from the repo root (backend.app.main)
(exec backend/.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port "${BACKEND_PORT:-8000}") &
pids+=($!)
(cd frontend && exec npm run dev -- --port "${FRONTEND_PORT:-5173}") &
pids+=($!)

printf "\n\033[1;36m▸ NEURAL//BRAIN\033[0m  UI → http://localhost:%s   API → http://localhost:%s/docs\n\n" \
  "${FRONTEND_PORT:-5173}" "${BACKEND_PORT:-8000}"
wait
