#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-8792}"
BASE="http://127.0.0.1:${PORT}"
COOKIE_JAR="${TMPDIR:-/tmp}/wingdex-api-smoke.cookies"
LOG_FILE="${TMPDIR:-/tmp}/wingdex-api-smoke.log"
SEED_MODE="${SEED_MODE:-false}"
SEED_CSV_PATH="${SEED_CSV_PATH:-e2e/fixtures/ebird-import.csv}"

cleanup() {
  if [[ -n "${WRANGLER_PID:-}" ]]; then
    kill "${WRANGLER_PID}" >/dev/null 2>&1 || true
    wait "${WRANGLER_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

rm -f "$COOKIE_JAR"

echo "[smoke] Applying local D1 migrations..."
printf 'y\n' | npx wrangler d1 migrations apply wingdex-db --local >/dev/null

echo "[smoke] Starting Pages dev server on :${PORT}..."
npx wrangler pages dev dist --port "$PORT" >"$LOG_FILE" 2>&1 &
WRANGLER_PID=$!

for _ in {1..30}; do
  if curl -fsS "$BASE/api/auth/get-session" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

request() {
  local name="$1"
  local method="$2"
  local url="$3"
  local data="${4:-}"
  local with_cookie="${5:-false}"

  local body_file
  body_file="$(mktemp)"

  local code
  if [[ "$method" == "GET" ]]; then
    if [[ "$with_cookie" == "true" ]]; then
      code="$(curl -sS -o "$body_file" -w "%{http_code}" -b "$COOKIE_JAR" "$url")"
    else
      code="$(curl -sS -o "$body_file" -w "%{http_code}" "$url")"
    fi
  else
    if [[ "$with_cookie" == "true" ]]; then
      code="$(curl -sS -o "$body_file" -w "%{http_code}" -X "$method" -b "$COOKIE_JAR" -H 'content-type: application/json' -d "$data" "$url")"
    else
      code="$(curl -sS -o "$body_file" -w "%{http_code}" -X "$method" -c "$COOKIE_JAR" -H 'content-type: application/json' -d "$data" "$url")"
    fi
  fi

  echo "[smoke] ${name}: HTTP ${code}"
  node -e '
const fs = require("fs");
const text = fs.readFileSync(process.argv[1], "utf8");
const compact = text.replace(/\s+/g, " ").trim();
console.log(compact.slice(0, 400));
' "$body_file"
  echo

  REPLY="$body_file"
  STATUS_CODE="$code"
}

request_form_file() {
  local name="$1"
  local url="$2"
  local file_path="$3"

  local body_file
  body_file="$(mktemp)"

  local code
  code="$(curl -sS -o "$body_file" -w "%{http_code}" -b "$COOKIE_JAR" -F "file=@${file_path};type=text/csv" "$url")"

  echo "[smoke] ${name}: HTTP ${code}"
  node -e '
const fs = require("fs");
const text = fs.readFileSync(process.argv[1], "utf8");
const compact = text.replace(/\s+/g, " ").trim();
console.log(compact.slice(0, 400));
' "$body_file"
  echo

  REPLY="$body_file"
  STATUS_CODE="$code"
}

request "unauth get-session" "GET" "$BASE/api/auth/get-session"
[[ "$STATUS_CODE" == "200" ]] || { echo "[smoke] FAIL: expected 200"; exit 1; }

request "anonymous sign-in" "POST" "$BASE/api/auth/sign-in/anonymous" '{}' "false"
[[ "$STATUS_CODE" == "200" ]] || { echo "[smoke] FAIL: expected 200"; exit 1; }

request "auth get-session" "GET" "$BASE/api/auth/get-session" '' "true"
[[ "$STATUS_CODE" == "200" ]] || { echo "[smoke] FAIL: expected 200"; exit 1; }

request "protected data/all" "GET" "$BASE/api/data/all" '' "true"
[[ "$STATUS_CODE" == "200" ]] || { echo "[smoke] FAIL: expected 200"; exit 1; }

OUTING_ID="smoke-outing-$(date +%s)"
OUTING_PAYLOAD="{\"id\":\"${OUTING_ID}\",\"startTime\":\"2026-02-20T08:00:00.000Z\",\"endTime\":\"2026-02-20T09:00:00.000Z\",\"locationName\":\"API Smoke Park\",\"createdAt\":\"2026-02-20T09:00:00.000Z\"}"
request "create outing" "POST" "$BASE/api/data/outings" "$OUTING_PAYLOAD" "true"
[[ "$STATUS_CODE" == "200" ]] || { echo "[smoke] FAIL: expected 200"; exit 1; }

if [[ "$SEED_MODE" == "true" ]]; then
  if [[ ! -f "$SEED_CSV_PATH" ]]; then
    echo "[smoke] FAIL: seed CSV not found at $SEED_CSV_PATH"
    exit 1
  fi

  request_form_file "preview eBird import" "$BASE/api/import/ebird-csv" "$SEED_CSV_PATH"
  [[ "$STATUS_CODE" == "200" ]] || { echo "[smoke] FAIL: expected 200"; exit 1; }

  CONFIRM_PAYLOAD="$(node -e '
const fs = require("fs");
const path = process.argv[1];
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const previewIds = Array.isArray(data.previews)
  ? data.previews.map((preview) => preview.previewId).filter(Boolean)
  : [];
if (previewIds.length === 0) process.exit(2);
process.stdout.write(JSON.stringify({ previewIds }));
' "$REPLY")" || {
    echo "[smoke] FAIL: unable to build confirm payload from preview response"
    exit 1
  }

  request "confirm eBird import" "POST" "$BASE/api/import/ebird-csv/confirm" "$CONFIRM_PAYLOAD" "true"
  [[ "$STATUS_CODE" == "200" ]] || { echo "[smoke] FAIL: expected 200"; exit 1; }
fi

request "data/all after create" "GET" "$BASE/api/data/all" '' "true"
[[ "$STATUS_CODE" == "200" ]] || { echo "[smoke] FAIL: expected 200"; exit 1; }

node -e '
const fs = require("fs");
const path = process.argv[1];
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const counts = {
  outings: Array.isArray(data.outings) ? data.outings.length : -1,
  photos: Array.isArray(data.photos) ? data.photos.length : -1,
  observations: Array.isArray(data.observations) ? data.observations.length : -1,
  dex: Array.isArray(data.dex) ? data.dex.length : -1,
};
console.log("[smoke] counts:", counts);
if (counts.outings < 1) process.exit(2);
if (process.env.SEED_MODE === "true") {
  if (counts.observations < 1 || counts.dex < 1) process.exit(3);
}
' "$REPLY"

echo "[smoke] PASS: authenticated API flow succeeded."
