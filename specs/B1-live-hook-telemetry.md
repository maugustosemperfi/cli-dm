# B1 — Live hook telemetry → cli-dm

> Status: Draft · Owner: maugusto · Depends on: — · Target: `~/dev/nu/cli-dm` + `~/.claude/settings.json`

## 1. Goal

Make a live Claude Code session (and its subagents) light up cli-dm in real time, by POSTing
Claude Code hook events to cli-dm's existing `/api/hooks` receiver. No new parsing — the
receiver and mapper already exist. This replaces post-hoc transcript replay with live events.

## 2. Current state (grounding)

- Receiver: `internal/ingestion/hooks.go` — `HookReceiver.ServeHTTP` reads
  `{ "hook_type": str, "payload": {…} }`, resolves/auto-creates an agent from
  `payload.session_id`, maps via `buildToolEvent` (handles `PreToolUse`, `PostToolUse`,
  `PostToolUseFailure`, `SessionStart`, `Stop`/`SessionEnd`, `SubagentStart`, `SubagentStop`,
  `PreCompact`, `PermissionRequest`, `UserPromptSubmit`, `Notification`), and broadcasts.
- Mounts (`cmd/cli-dm/main.go:807-814`): `/api/ws`, `/api/hooks`, `/api/hooks/register` —
  the hook routes mount **only when** a config agent has `source: hooks`.
- Auth: `hooks_auth` in `dungeon.yaml` → `Authorization: Bearer <token>`.
- Default port **8420**. `examples/dungeon-live.yaml` already references a relay at
  `scripts/cli-dm-hook.sh` and a `source: hooks` agent ("Red Rogue").

## 3. Scope

**In:** the relay script (`scripts/cli-dm-hook.sh`, confirm/repair the referenced one);
`settings.json` hook registrations; a documented `dungeon.yaml`; non-blocking/fail-safe
behavior; docs. **Out:** changing the receiver/mapper (only extend if a needed hook type is
unmapped); the dungeon visuals.

## 4. Interface contract

Relay reads a Claude Code hook JSON on **stdin**, wraps and forwards:

```
POST http://localhost:${CLI_DM_PORT:-8420}/api/hooks
Authorization: Bearer ${CLI_DM_HOOK_TOKEN}
Content-Type: application/json

{ "hook_type": "<PreToolUse|PostToolUse|SubagentStart|SubagentStop|Stop|SessionStart|…>",
  "payload":   <the raw hook stdin JSON, incl. session_id, tool_name, tool_input, tool_response, model> }
```

`settings.json` registers the relay for at least: `PreToolUse`, `PostToolUse`, `SubagentStart`,
`SubagentStop`, `Stop`, `SessionStart`. Hook type is passed to the relay (arg or env) and
copied into `hook_type`.

## 5. Requirements

| ID | MUST/SHOULD | Requirement |
|----|------|-------------|
| B1-R1 | MUST | A `PostToolUse` for an `Edit`/`Read` in a live session produces a broadcast action event on `/api/ws` for the mapped agent. |
| B1-R2 | MUST | The relay is **non-blocking and fail-safe**: short connect timeout, fire-and-forget, and it exits 0 even when cli-dm is down/unreachable — it must NEVER stall or fail the Claude Code turn. |
| B1-R3 | MUST | Auth token comes from env (not hard-coded); matches `dungeon.yaml`'s `hooks_auth`; a wrong token yields 401 and the session is still unaffected. |
| B1-R4 | MUST | Subagents appear as distinct characters: `SubagentStart`/`SubagentStop` map to spawn/stop of a child agent. |
| B1-R5 | MUST | `hook_type` is set correctly per registration (no event is mislabeled). |
| B1-R6 | SHOULD | A run-book documents: start cli-dm with the hooks config, set the token env, what each hook maps to, and how to disable. |
| B1-R7 | SHOULD | If any required hook type is unmapped by the receiver, extend `buildToolEvent` minimally (with a test) rather than dropping it. |

## 6. Verification

| R | Method | Pass condition |
|---|--------|----------------|
| B1-R1 | Integration: run cli-dm w/ hooks config, connect a WS client, POST a sample `PostToolUse` (or do a real Edit) | a corresponding action event is received on `/api/ws` |
| B1-R2 | Stop cli-dm, fire the relay; also point at a black-hole port | relay exits 0 within its timeout; measured added latency under a set budget (e.g. <150ms) |
| B1-R3 | POST with wrong Bearer | HTTP 401; with right token → 200; session unaffected either way |
| B1-R4 | Drive a session that spawns a subagent | a second character spawns and stops in the snapshot |
| B1-R5 | Unit/inspection of relay + settings | each registration forwards its own `hook_type` |
| B1-R6 | Doc review | a fresh user can stand it up from the run-book alone |
| B1-R7 | Test for any added mapping | new hook type yields the intended event |

## 7. Test plan

- `curl` integration script: boot cli-dm with a `dungeon.yaml` (one `source: hooks` agent),
  open a WS client, POST canned payloads for each hook type, assert broadcasts.
- Failure-injection test for B1-R2 (cli-dm down / black-hole port / bad token).
- Manual end-to-end: real Claude Code session in another repo → watch the dungeon at
  `http://localhost:8420`.

## 8. Open decisions

- **D-B1-1 — relay language:** reuse/repair the referenced `scripts/cli-dm-hook.sh` (bash +
  `curl --max-time`) vs a tiny Python relay. Recommend bash+curl (zero deps, easiest fail-safe).
- **D-B1-2 — scope of hooks:** start with the 6 above; add `PermissionRequest`/`PreCompact`/
  `Notification` only if they add signal (receiver already maps them).

## Changelog
- Draft — initial spec.
