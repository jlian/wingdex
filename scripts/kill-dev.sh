#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pkill -f "${ROOT_DIR}/node_modules/.bin/wrangler pages dev dist" >/dev/null 2>&1 || true
pkill -f "${ROOT_DIR}/node_modules/@cloudflare/workerd-.*/bin/workerd serve" >/dev/null 2>&1 || true
pkill -f "${ROOT_DIR}/node_modules/.*/@esbuild/.*/bin/esbuild --service" >/dev/null 2>&1 || true
pkill -f "${ROOT_DIR}/node_modules/.bin/vite --port 5000 --strictPort" >/dev/null 2>&1 || true

PIDS="$( { lsof -t -nP -iTCP:5000 -sTCP:LISTEN || true; lsof -t -nP -iTCP:8788 -sTCP:LISTEN || true; } 2>/dev/null | sort -u | tr '\n' ' ' )"
if [[ -n "${PIDS// }" ]]; then
  kill ${PIDS} >/dev/null 2>&1 || true
fi
