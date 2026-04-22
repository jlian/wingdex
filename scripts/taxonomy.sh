#!/usr/bin/env bash
set -euo pipefail

CMD="${1:-}"
shift 2>/dev/null || true

case "${CMD}" in
  ebird)    exec node scripts/fetch-ebird-codes.mjs "$@" ;;
  hydrate)  exec node scripts/hydrate-wiki-titles.mjs "$@" ;;
  validate) exec node scripts/validate-wikipedia.mjs "$@" ;;
  *)
    echo "Usage: npm run taxonomy -- <command> [options]"
    echo ""
    echo "Commands:"
    echo "  ebird     Fetch eBird taxonomy codes"
    echo "  hydrate   Rehydrate Wikipedia titles and thumbnails"
    echo "  validate  Validate Wikipedia metadata"
    exit 1
    ;;
esac
