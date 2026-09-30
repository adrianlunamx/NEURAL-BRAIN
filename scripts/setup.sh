#!/usr/bin/env bash
# neural-brain · one-shot setup (Linux / macOS)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

c() { printf "\033[%sm%s\033[0m\n" "$1" "$2"; }
c "1;36" "▸ neural-brain setup"

PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null || { c 31 "✗ python3 not found (need 3.10+)"; exit 1; }
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || { c 31 "✗ Python 3.10+ required"; exit 1; }
command -v npm >/dev/null || { c 31 "✗ npm not found (need Node 20.19+)"; exit 1; }

c 36 "▸ backend: virtualenv + dependencies (no PyTorch: embeddings run on ONNX)"
cd backend
[ -d .venv ] || "$PY" -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null
pip install -r requirements.txt
[ -f .env ] || { cp .env.example .env; c 33 "  created backend/.env → put your ANTHROPIC_API_KEY there"; }
deactivate
cd ..

c 36 "▸ frontend: npm install"
cd frontend
npm install --no-audit --no-fund
[ -f .env ] || cp .env.example .env
cd ..

c 32 "✓ setup complete"
echo
echo "  1. edit backend/.env and set ANTHROPIC_API_KEY=sk-ant-..."
echo "  2. ./scripts/run.sh   → http://localhost:5173"
echo "  3. optional: make hooks  → see Claude Code live in the brain"
