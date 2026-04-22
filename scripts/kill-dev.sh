#!/usr/bin/env bash
set -euo pipefail

VITE_PORT="${VITE_PORT:-5000}"
API_PORT="${API_PORT:-8787}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pkill -f "${ROOT_DIR}/node_modules/.bin/wrangler dev" >/dev/null 2>&1 || true
pkill -f "${ROOT_DIR}/node_modules/@cloudflare/workerd-.*/bin/workerd serve" >/dev/null 2>&1 || true
pkill -f "${ROOT_DIR}/node_modules/.*/@esbuild/.*/bin/esbuild --service" >/dev/null 2>&1 || true
pkill -f "${ROOT_DIR}/node_modules/.bin/vite --port ${VITE_PORT} --strictPort" >/dev/null 2>&1 || true

PIDS="$( { lsof -t -nP -iTCP:"${VITE_PORT}" -sTCP:LISTEN || true; lsof -t -nP -iTCP:"${API_PORT}" -sTCP:LISTEN || true; } 2>/dev/null | sort -u | tr '\n' ' ' )"
if [[ -n "${PIDS// }" ]]; then
  kill ${PIDS} >/dev/null 2>&1 || true
fi
