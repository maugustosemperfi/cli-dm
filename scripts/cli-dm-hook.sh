#!/bin/bash
# cli-dm-hook.sh — Claude Code hook for CLI_DM visualization
#
# Configure in ~/.claude/settings.json under hooks.PostToolUse, etc.
# Reads hook JSON from stdin and POSTs to CLI_DM server.
#
# Environment variables:
#   CLI_DM_URL   — Base URL of the CLI_DM server (default: http://localhost:8420)
#   CLI_DM_TOKEN — Optional auth token for the CLI_DM server
#
# The hook event name is passed via CLAUDE_HOOK_EVENT_NAME (or as the first
# positional argument in some Claude Code versions). We check both.

CLI_DM_URL="${CLI_DM_URL:-http://localhost:8420}"
CLI_DM_TOKEN="${CLI_DM_TOKEN:-}"

payload=$(cat)

# Determine hook type: env var takes precedence, then first argument
hook_type="${CLAUDE_HOOK_EVENT_NAME:-}"
if [ -z "$hook_type" ] && [ -n "${1:-}" ]; then
  hook_type="$1"
fi
if [ -z "$hook_type" ]; then
  hook_type="unknown"
fi

# Build auth header if token is set
auth_args=()
if [ -n "$CLI_DM_TOKEN" ]; then
  auth_args=(-H "Authorization: Bearer ${CLI_DM_TOKEN}")
fi

# POST async — fire-and-forget, short timeouts so zombies never linger
curl -s -X POST \
  --max-time 2 \
  --connect-timeout 1 \
  "${CLI_DM_URL}/api/hooks" \
  -H "Content-Type: application/json" \
  "${auth_args[@]}" \
  -d "{\"hook_type\":\"${hook_type}\",\"payload\":${payload}}" \
  > /dev/null 2>&1 &
