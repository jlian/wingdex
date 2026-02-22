#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-8788}"
VITE_PORT="${VITE_PORT:-5000}"

pick_available_api_port() {
  local port="${API_PORT}"
  while lsof -t -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; do
    port="$((port + 1))"
  done

  if [[ "${port}" != "${API_PORT}" ]]; then
    echo "[dev] API port ${API_PORT} is in use. Falling back to :${port}."
  fi

  API_PORT="${port}"
  export API_PORT
}

ensure_vite_port_available() {
  local pids
  pids="$(lsof -t -nP -iTCP:"${VITE_PORT}" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ' || true)"
  if [[ -z "${pids// }" ]]; then
    return
  fi

  for pid in ${pids}; do
    local cmd
    cmd="$(ps -p "${pid}" -o comm= | xargs)"
    if [[ "${cmd}" == "workerd" ]]; then
      echo "[dev] Port ${VITE_PORT} is occupied by workerd (likely wrangler pages dev). Stopping it for Vite HMR..."
      kill "${pid}" >/dev/null 2>&1 || true
    else
      echo "[dev] Port ${VITE_PORT} is already in use by PID ${pid} (${cmd})."
      echo "[dev] Stop it first (or run: npm run kill), then retry npm run dev."
      exit 1
    fi
  done

  sleep 1
  if lsof -t -nP -iTCP:"${VITE_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[dev] Failed to free port ${VITE_PORT}."
    exit 1
  fi
}

cleanup() {
  if [[ -n "${CF_PID:-}" ]]; then
    kill "${CF_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

ensure_vite_port_available
pick_available_api_port

echo "[dev] Starting Cloudflare Functions on :${API_PORT}..."
npm run dev:cf -- --port "${API_PORT}" &
CF_PID=$!

sleep 1

echo "[dev] Starting Vite with HMR..."
exec npm run dev:vite
