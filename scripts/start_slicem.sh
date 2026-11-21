#!/usr/bin/env bash
# ==============================================================================
# SliceM Full-Stack Unified Development Server Launcher
# Starts FastAPI Backend (port 8000) & Vite Frontend (port 5173) Concurrently
# ==============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/frontend"

echo "======================================================================"
echo " Starting SliceM Full-Stack Pipeline (macOS / Linux Development)"
echo " Repository: $REPO_DIR"
echo "======================================================================"

# Determine Python virtualenv binary
VENV_PYTHON="$BACKEND_DIR/.venv/bin/python"
VENV_UVICORN="$BACKEND_DIR/.venv/bin/uvicorn"

if [ ! -f "$VENV_UVICORN" ]; then
    echo "ERROR: Backend virtualenv not found at $BACKEND_DIR/.venv"
    echo "Please create virtualenv and install requirements: (cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt)"
    exit 1
fi

# Clean shutdown trap
cleanup() {
    echo -e "\nShutting down SliceM backend & frontend services..."
    if [ -n "${BACKEND_PID:-}" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "${FRONTEND_PID:-}" ]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    wait 2>/dev/null || true
    echo "All SliceM services terminated cleanly."
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

# 1. Start FastAPI Backend
echo "--> Starting FastAPI Backend on http://0.0.0.0:8000..."
(
    cd "$BACKEND_DIR"
    export PYTHONPATH="$BACKEND_DIR"
    exec "$VENV_UVICORN" app.main:app --host 0.0.0.0 --port 8000 --reload
) &
BACKEND_PID=$!

# 2. Start Vite Frontend
echo "--> Starting Vite React Frontend on http://localhost:5173..."
(
    cd "$FRONTEND_DIR"
    exec npm run dev
) &
FRONTEND_PID=$!

echo ""
echo "======================================================================"
echo " SliceM is running!"
echo "   Web Application:       http://localhost:5173"
echo "   Interactive API Docs:  http://localhost:8000/docs"
echo "   Backend Health:        http://localhost:8000/health"
echo " Press Ctrl+C at any time to stop both servers."
echo "======================================================================"
echo ""

# Wait for background jobs
wait "$BACKEND_PID" "$FRONTEND_PID"
