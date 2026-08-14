#!/usr/bin/env bash
set -euo pipefail

# End-to-end local dev launcher for dbt-docs-in-steroids.
#
#   Postgres  → Docker container (via be/dev.sh)
#   Backend   → FastAPI/uvicorn on the host  (http://localhost:8000)
#   Frontend  → Vite dev server on the host  (http://localhost:5173)
#
# Runs both host processes in the background and streams their logs. Ctrl-C
# stops the backend + frontend; Postgres keeps running in Docker (stop it with
# `docker stop dbtsteroids-postgres`).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BE_DIR="$ROOT/be"
UI_DIR="$ROOT/ui"
LOG_DIR="$ROOT/.dev-logs"
BACKEND_PORT=8000
FRONTEND_PORT=5173

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
info()  { echo "${BOLD}${GREEN}==>${RESET} ${BOLD}$*${RESET}"; }
warn()  { echo "${BOLD}${YELLOW}!  ${RESET} $*"; }
die()   { echo "${BOLD}${RED}✗  ${RESET} $*" >&2; exit 1; }

# ---- Prerequisites ---------------------------------------------------------
info "Checking prerequisites"
command -v docker >/dev/null 2>&1 || die "docker not found. Install Docker Desktop and start it."
command -v uv     >/dev/null 2>&1 || die "uv not found. Install: curl -LsSf https://astral.sh/uv/install.sh | sh"
command -v pnpm   >/dev/null 2>&1 || die "pnpm not found. Install: brew install pnpm (or npm i -g pnpm)"
docker info >/dev/null 2>&1 || die "Docker daemon isn't running. Start Docker Desktop and retry."

mkdir -p "$LOG_DIR"

# ---- Backend deps + .env ---------------------------------------------------
if [[ ! -f "$BE_DIR/.env" ]]; then
  warn "be/.env missing — creating from .env.example"
  cp "$BE_DIR/.env.example" "$BE_DIR/.env"
  warn "Edit ${BOLD}be/.env${RESET} and set DEFAULT_DBT_PROJECT_PATH to your dbt project (its target/ needs a fresh manifest.json)."
fi

info "Installing backend dependencies (uv sync)"
( cd "$BE_DIR" && uv sync )

# ---- Postgres (Docker) + migrations ---------------------------------------
info "Starting Postgres container + running migrations (be/dev.sh)"
( cd "$BE_DIR" && ./dev.sh )

# ---- Frontend deps ---------------------------------------------------------
info "Installing frontend dependencies (pnpm install)"
( cd "$UI_DIR" && pnpm install )

# ---- Launch host processes -------------------------------------------------
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo
  info "Shutting down host processes (Postgres container keeps running)"
  [[ -n "$FRONTEND_PID" ]] && kill "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID"  ]] && kill "$BACKEND_PID"  2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup INT TERM EXIT

info "Starting backend  → http://localhost:${BACKEND_PORT}  (logs: .dev-logs/backend.log)"
( cd "$BE_DIR" && exec uv run uvicorn main:app --reload --port "$BACKEND_PORT" ) >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!

# Wait for the API to answer before starting Vite (it proxies /api → :8000).
info "Waiting for backend to become ready…"
for i in {1..60}; do
  if curl -sf "http://localhost:${BACKEND_PORT}/docs" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo; tail -n 40 "$LOG_DIR/backend.log" || true
    die "Backend exited during startup. See .dev-logs/backend.log above."
  fi
  sleep 1
  [[ $i -eq 60 ]] && warn "Backend still not answering after 60s — starting frontend anyway."
done

info "Starting frontend → http://localhost:${FRONTEND_PORT}  (logs: .dev-logs/frontend.log)"
( cd "$UI_DIR" && exec pnpm dev --port "$FRONTEND_PORT" ) >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!

echo
info "Stack is up:"
echo "   ${DIM}Frontend${RESET}  http://localhost:${FRONTEND_PORT}"
echo "   ${DIM}Backend ${RESET}  http://localhost:${BACKEND_PORT}   (API docs at /docs)"
echo "   ${DIM}Postgres${RESET}  docker container 'dbtsteroids-postgres' on :5432"
echo
echo "   Tailing logs — press ${BOLD}Ctrl-C${RESET} to stop backend + frontend."
echo

# Stream both logs; exits (and triggers cleanup) when a process dies.
tail -n +1 -F "$LOG_DIR/backend.log" "$LOG_DIR/frontend.log" &
TAIL_PID=$!

# Poll both host PIDs (portable — avoids `wait -n`, which needs bash 4.3+).
# When either exits, tear everything down.
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done
kill "$TAIL_PID" 2>/dev/null || true
warn "A host process exited — shutting down."
