#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5000}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-8}"
STARTUP_GRACE_SECONDS="${STARTUP_GRACE_SECONDS:-15}"

dev_pid=""

is_healthy() {
  curl -fsS "${BASE_URL}" >/dev/null 2>&1 && curl -fsS "${BASE_URL}/api/auth/get-session" >/dev/null 2>&1
}

start_dev() {
  echo "App unhealthy/missing on :5000, restarting dev server"
  npm run kill >/dev/null 2>&1 || true

  npm run dev &
  dev_pid="$!"
}

stop_dev() {
  if [[ -n "${dev_pid}" ]] && kill -0 "${dev_pid}" >/dev/null 2>&1; then
    kill "${dev_pid}" >/dev/null 2>&1 || true
    wait "${dev_pid}" >/dev/null 2>&1 || true
  fi

  dev_pid=""
}

cleanup() {
  stop_dev
}

trap cleanup EXIT INT TERM

if is_healthy; then
  echo "App already healthy on :5000"
else
  start_dev
  sleep "${STARTUP_GRACE_SECONDS}"
fi

while true; do
  if [[ -n "${dev_pid}" ]] && ! kill -0 "${dev_pid}" >/dev/null 2>&1; then
    echo "Dev process exited unexpectedly, restarting"
    dev_pid=""
    start_dev
    sleep "${STARTUP_GRACE_SECONDS}"
    continue
  fi

  if ! is_healthy; then
    stop_dev
    start_dev
    sleep "${STARTUP_GRACE_SECONDS}"
  fi

  sleep "${CHECK_INTERVAL_SECONDS}"
done
