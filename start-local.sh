#!/usr/bin/env bash
set -e

# ── paths ─────────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
AI_DIR="$REPO_ROOT/services/ai"
WEB_DIR="$REPO_ROOT/apps/web"

# ── pnpm ─────────────────────────────────────────────────────────────
export PNPM_HOME="$HOME/Library/pnpm"
export PATH="$PNPM_HOME/bin:$PATH"

# ── pyenv + Python 3.12 ───────────────────────────────────────────────
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init - bash)" 2>/dev/null || true
PYTHON=$(pyenv which python3.12 2>/dev/null || pyenv which python3 2>/dev/null || which python3)
echo "Using Python: $PYTHON ($($PYTHON --version))"

# ── check .env files are filled ──────────────────────────────────────
check_placeholder() {
  local file="$1"
  if grep -q "PASTE_YOUR" "$file" 2>/dev/null; then
    echo ""
    echo "ERROR: $file still has placeholder values."
    echo "Open it and replace every PASTE_YOUR_... with your real keys."
    exit 1
  fi
}
check_placeholder "$AI_DIR/.env"
check_placeholder "$WEB_DIR/.env.local"

# ── Python venv ───────────────────────────────────────────────────────
VENV="$AI_DIR/.venv"
if [ ! -d "$VENV" ]; then
  echo "Creating Python venv..."
  $PYTHON -m venv "$VENV"
fi
source "$VENV/bin/activate"
pip install -e "$AI_DIR[dev]" -q

# ── start AI service ──────────────────────────────────────────────────
echo ""
echo "Starting AI service on :8000 ..."
cd "$AI_DIR"
uvicorn app.main:app --reload --port 8000 &
AI_PID=$!

# ── start web app ─────────────────────────────────────────────────────
echo "Starting Next.js web app on :3000 ..."
cd "$REPO_ROOT"
pnpm --filter web dev &
WEB_PID=$!

echo ""
echo "============================================================"
echo "  Relay is starting up"
echo "  Web app:    http://localhost:3000"
echo "  AI service: http://localhost:8000"
echo "  Medic view: http://localhost:3000/medic"
echo "  Hospital:   http://localhost:3000/hospital"
echo "============================================================"
echo "Press Ctrl+C to stop both services"
echo ""

trap "kill $AI_PID $WEB_PID 2>/dev/null; exit" INT TERM
wait
