# B2 — cli-dm control-plane MCP

> Status: Draft · Owner: maugusto · Depends on: B1 · Target: `~/dev/nu/cli-dm`

## 1. Goal

Let an agent query its own dungeon — "who's blocked? what's the DAG state? what is each agent
doing?" — by exposing cli-dm's already-computed snapshot over a read-only HTTP endpoint and a
small MCP server. Turns cli-dm from a view into a control plane the agent can reason over.

## 2. Current state (grounding)

- `cmd/cli-dm/main.go:235` builds `hub := server.NewHub(buildSnapshot, logger)`; `buildSnapshot`
  merges PTY + external (hooks/watch) agents into a `protocol.StateSnapshot`.
- `internal/server/ws.go` — `Hub` has `SnapshotFunc` and a `CommandHandler` (browser→backend).
- Task DAG lives in the `dag` package (`taskGraph`).
- No GET endpoint currently exposes the snapshot; it's only pushed to WS clients.

## 3. Scope

**In:** a read-only `GET /api/snapshot` (current `StateSnapshot` + DAG as JSON); a small MCP
server exposing 2–3 read tools over it. **Out:** mutating the dungeon from the agent (no
commands); auth model changes beyond reuse of `hooks_auth`.

## 4. Interface contract

```
GET /api/snapshot   (Bearer hooks_auth if set)
  -> { agents: [{id,name,role,status,current_action,blocked?,task_id}],
       dag:    [{id,label,agent_id,status,depends_on:[…]}],
       ts }

MCP tools (read-only):
  dungeon_snapshot()           -> the JSON above
  dungeon_blocked()            -> [{agent_id, task_id, reason}]      # agents in blocked status
  dungeon_dag()                -> nodes + edges + per-node status
```

## 5. Requirements

| ID | MUST/SHOULD | Requirement |
|----|------|-------------|
| B2-R1 | MUST | `GET /api/snapshot` returns the same `StateSnapshot` the hub serves to new WS clients (single source — reuse `buildSnapshot`, no parallel state). |
| B2-R2 | MUST | Endpoint is read-only and side-effect free; honors `hooks_auth` when set. |
| B2-R3 | MUST | `dungeon_blocked()` returns exactly the agents whose status is blocked in the snapshot. |
| B2-R4 | MUST | `dungeon_dag()` reflects live node statuses (pending/in_progress/completed/failed/blocked) and dependency edges. |
| B2-R5 | MUST | Response is stable JSON matching the contract; an empty dungeon returns empty arrays, not an error. |
| B2-R6 | SHOULD | MCP server is a thin wrapper over the HTTP endpoint (so it works against any running cli-dm; no duplicate Go state). |

## 6. Verification

| R | Method | Pass condition |
|---|--------|----------------|
| B2-R1 | Integration: connect a WS client and GET /api/snapshot together | agent/DAG sets match |
| B2-R2 | Re-GET; diff dungeon state | no change; 401 without token when auth set |
| B2-R3 | Seed a blocked agent (hooks `blocked` path or fixture), call `dungeon_blocked` | that agent listed, others not |
| B2-R4 | Drive a DAG to mixed statuses | statuses + edges match the live graph |
| B2-R5 | GET on a freshly started empty dungeon | `{agents:[],dag:[],ts}` |
| B2-R6 | Point MCP at a running cli-dm | tools return without embedding cli-dm state |

## 7. Test plan

- Go test for the `/api/snapshot` handler (reuses `buildSnapshot`; empty + populated cases).
- MCP server test against a stub/real endpoint: `dungeon_snapshot/blocked/dag` shape + blocked filtering.
- Manual: with B1 live, ask an agent (via the MCP) "who's blocked?" mid-Workflow.

## 8. Open decisions

- **D-B2-1 — MCP language/host:** (a) Python wrapper hitting `/api/snapshot` — **recommended**,
  reuses the A-family MCP scaffolding, decoupled from cli-dm's binary; (b) embed an MCP server
  in the Go process. Pick (a) unless tight coupling is wanted.
- **D-B2-2 — later: write commands** (re-route/unblock) are explicitly deferred; keep B2 read-only.

## Changelog
- Draft — initial spec.
