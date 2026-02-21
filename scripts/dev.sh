#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-8788}"

cleanup() {
  if [[ -n "${CF_PID:-}" ]]; then
    kill "${CF_PID}" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

echo "[dev] Starting Cloudflare Functions on :${API_PORT}..."
npm run dev:cf -- --port "${API_PORT}" &
CF_PID=$!

sleep 1

echo "[dev] Starting Vite with HMR..."
exec npm run dev:vite
