#!/usr/bin/env bash
set -euo pipefail

if curl -fsS http://localhost:5000 >/dev/null 2>&1 && curl -fsS http://localhost:5000/api/auth/get-session >/dev/null 2>&1; then
  echo "App already healthy on :5000"
  exit 0
fi

echo "App unhealthy/missing on :5000, restarting dev server"
npm run kill
exec npm run dev
