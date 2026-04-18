#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:5000}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-8}"
STARTUP_GRACE_SECONDS="${STARTUP_GRACE_SECONDS:-15}"
LOCK_DIR="/tmp/wingdex-ensure-app-on-5000.lock"

dev_pid=""
managed_stack="false"

acquire_lock() {
  if mkdir "${LOCK_DIR}" >/dev/null 2>&1; then
    echo "$$" > "${LOCK_DIR}/pid"
    return
  fi

  local existing_pid=""
  if [[ -f "${LOCK_DIR}/pid" ]]; then
    existing_pid="$(cat "${LOCK_DIR}/pid" 2>/dev/null || true)"
  fi

  if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" >/dev/null 2>&1; then
    echo "ensure-app-on-5000 already running (PID ${existing_pid})"
    exit 0
  fi

  rm -rf "${LOCK_DIR}" >/dev/null 2>&1 || true
  if mkdir "${LOCK_DIR}" >/dev/null 2>&1; then
    echo "$$" > "${LOCK_DIR}/pid"
    return
  fi

  echo "Failed to acquire ensure-app-on-5000 lock"
  exit 1
}

release_lock() {
  local owner_pid=""
  if [[ -f "${LOCK_DIR}/pid" ]]; then
    owner_pid="$(cat "${LOCK_DIR}/pid" 2>/dev/null || true)"
  fi

  if [[ "${owner_pid}" == "$$" ]]; then
    rm -rf "${LOCK_DIR}" >/dev/null 2>&1 || true
  fi
}

is_healthy() {
  curl -fsS "${BASE_URL}" >/dev/null 2>&1 && curl -fsS "${BASE_URL}/api/health" >/dev/null 2>&1
}

start_dev() {
  echo "App unhealthy/missing on :5000, restarting dev server"
  npm run kill >/dev/null 2>&1 || true

  npm run dev &
  dev_pid="$!"
  managed_stack="true"
}

stop_dev() {
  if [[ -n "${dev_pid}" ]] && kill -0 "${dev_pid}" >/dev/null 2>&1; then
    kill -TERM -- "-${dev_pid}" >/dev/null 2>&1 || kill -TERM "${dev_pid}" >/dev/null 2>&1 || true

    for _ in 1 2 3 4 5; do
      if ! kill -0 "${dev_pid}" >/dev/null 2>&1; then
        break
      fi

      sleep 1
    done

    if kill -0 "${dev_pid}" >/dev/null 2>&1; then
      kill -KILL -- "-${dev_pid}" >/dev/null 2>&1 || kill -KILL "${dev_pid}" >/dev/null 2>&1 || true
    fi
  fi

  dev_pid=""
}

cleanup() {
  stop_dev

  if [[ "${managed_stack}" == "true" ]]; then
    npm run kill >/dev/null 2>&1 || true
  fi

  release_lock
}

trap cleanup EXIT INT TERM

acquire_lock

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
