#!/bin/bash
set -e

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.toolName')

# Only inspect bash commands
if [ "$TOOL_NAME" != "bash" ]; then
  exit 0
fi

COMMAND=$(echo "$INPUT" | jq -r '.toolArgs' | jq -r '.command')

# Match git push (with optional flags/args)
if echo "$COMMAND" | grep -qE '\bgit\b.*\bpush\b'; then
  jq -n '{permissionDecision: "deny", permissionDecisionReason: "git push requires explicit user approval"}'
fi
