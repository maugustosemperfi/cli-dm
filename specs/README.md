# cli-dm specs (B-family)

Verification specs for the agent-observability features of cli-dm. These are the **driving
documents** an agent (or the `maugusto-agent-work-review` skill) audits implementation against.

| ID | Feature | Depends on | Size | Status |
|----|---------|-----------|------|--------|
| **B1** | Live hook telemetry → cli-dm | — | XS | Draft |
| **B2** | cli-dm control-plane MCP | B1 | S–M | Draft |

The companion A-family specs (the notes MCP) live in `~/dev/nu-notes-mcp/specs/`, which also
holds the **master plan, build order, and the spec/verification protocol** (R-IDs, status
lifecycle, "spec is source of truth"). Read that first.

## Why these are cheap

cli-dm already has the inbound machinery:
- `internal/ingestion/hooks.go` — `HookReceiver` accepts `POST /api/hooks` with
  `{hook_type, payload}` and maps `PreToolUse/PostToolUse/SubagentStart/SubagentStop/Stop/…`
  → protocol events. Bearer auth via `hooks_auth`. Mounted at `cmd/cli-dm/main.go:812`.
- `internal/server/ws.go` — `Hub` broadcasts events to the browser on `/api/ws` and already
  computes a full `StateSnapshot` (`SnapshotFunc`) + has a `CommandHandler`.

So **B1 is wiring** (relay + settings.json + a `source: hooks` agent in `dungeon.yaml`), and
**B2 exposes state cli-dm already materializes**.
