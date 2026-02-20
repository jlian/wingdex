#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-5000}"
BASE="http://127.0.0.1:${PORT}"
FORCE_RESTART="${FORCE_RESTART:-false}"

is_port_listening() {
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1
}

running_full_app() {
  curl -fsS "${BASE}/" >/dev/null 2>&1 && curl -fsS "${BASE}/api/auth/get-session" >/dev/null 2>&1
}

if [[ "${FORCE_RESTART}" == "true" ]]; then
  if is_port_listening; then
    echo "[dev:full] Port ${PORT} is in use. Force-restarting listener(s)..."
    PIDS="$(lsof -t -nP -iTCP:"${PORT}" -sTCP:LISTEN | tr '\n' ' ')"
    if [[ -n "${PIDS// }" ]]; then
      kill ${PIDS} >/dev/null 2>&1 || true
      sleep 1
    fi

    if is_port_listening; then
      echo "[dev:full] Failed to free port ${PORT}."
      exit 1
    fi
  fi
else
  if running_full_app; then
    echo "[dev:full] App already running at ${BASE}. Reusing existing server."
    exit 0
  fi

  if is_port_listening; then
    echo "[dev:full] Port ${PORT} is already in use by another process."
    echo "[dev:full] If you want a fresh full-app server on this port, run: npm run dev:full:restart"
    exit 1
  fi
fi

echo "[dev:full] Applying local D1 migrations..."
printf 'y\n' | npx wrangler d1 migrations apply wingdex-db --local >/dev/null

echo "[dev:full] Building app..."
npm run build >/dev/null

echo "[dev:full] Starting full local app at ${BASE}..."
exec npx wrangler pages dev dist --port "${PORT}" --show-interactive-dev-session=false
