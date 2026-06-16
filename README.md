# CLI_DM

AI Agent Dungeon Master: a live dungeon map for Claude Code and parallel agent work.

`cli-dm` watches agent activity and turns it into a small RPG interface. Agents become characters. Tasks become quest nodes. Blockers become doors and encounters. Claude Code JSONL sessions become maps you can watch as they unfold.

## What it does

- Spawns local agent commands through a PTY.
- Reads Claude Code `--output-format stream-json` output.
- Receives Claude Code hook events over HTTP.
- Watches Claude Code JSONL session files under `~/.claude/projects/`.
- Auto-discovers active projects under a directory and creates watcher agents for them.
- Serves a React/Pixi dungeon UI over WebSocket.
- Records sessions to `~/.cli-dm/sessions` when enabled.

The UI includes a dungeon map, agent sidebar, live feed, quest log, timeline, score overlay, command palette, world map, and persistent session state.

## Why

Claude Code already writes rich session logs, but they are hard to read while work is happening. `cli-dm` treats those logs as a game-state stream: reads, edits, shell commands, tests, blockers, task dependencies, and session changes become visible events instead of invisible terminal churn.

It is part observability tool, part progress tracker, part playful interface for understanding what multiple agents are doing.

## Requirements

- Go `1.26.1`
- Node.js and npm
- Claude Code, for live Claude integrations

## Install dependencies

```bash
make deps
```

This runs `go mod tidy` and installs the web app dependencies under `web/`.

## Quick start

Run the simulated dungeon:

```bash
make dev
```

This starts:

- Go backend: `http://localhost:8420`
- Vite web app: `http://localhost:5173`
- WebSocket endpoint: `ws://localhost:8420/api/ws`

Open `http://localhost:5173`.

## Run from a config file

```bash
go run ./cmd/cli-dm run --config examples/dungeon.yaml
```

or:

```bash
make dev-config
```

`examples/dungeon.yaml` starts a few fake agents and demonstrates task dependencies.

## Watch live Claude Code sessions

Claude Code stores JSONL session files under:

```text
~/.claude/projects/<encoded-project-path>/*.jsonl
```

To watch active Claude sessions for projects under a parent directory:

```bash
go run ./cmd/cli-dm run --config examples/dungeon-watch-all.yaml
```

The example config watches `~/dev/nu/` for sessions active in the last 24 hours:

```yaml
port: 8420
watch_dir: "~/dev/nu/"
watch_age: "24h"

sessions:
  enabled: true
  retention_days: 30
```

Each recently active project gets its own character on the dungeon map.

## Watch one project or one JSONL file

Use `source: watch` with a project directory:

```yaml
adapter: claude
port: 8420

agents:
  - name: "Green Ranger"
    role: ranger
    source: watch
    project: "~/dev/cli-dm"
    task: "Monitor Session"
```

Or point directly at a JSONL file:

```yaml
agents:
  - name: "Purple Mage"
    role: mage
    source: watch
    watch_file: "~/.claude/projects/-Users-marcos-dev-myproject/abc123.jsonl"
    task: "Write Docs"
```

## Use Claude hooks

`cli-dm` can receive Claude Code hook events at:

```text
POST http://localhost:8420/api/hooks
```

Use `scripts/cli-dm-hook.sh` from Claude Code hooks. The script reads hook JSON from stdin and posts it to the running `cli-dm` server.

Environment variables:

- `CLI_DM_URL`: server URL, default `http://localhost:8420`
- `CLI_DM_TOKEN`: optional bearer token

Example config:

```yaml
adapter: claude
port: 8420
hooks_auth: "my-secret-token"

agents:
  - name: "Red Rogue"
    role: rogue
    source: hooks
    task: "Code Review"
```

Then configure Claude Code hooks to call:

```bash
/absolute/path/to/scripts/cli-dm-hook.sh
```

When `hooks_auth` is set, export the same token before starting Claude Code:

```bash
export CLI_DM_TOKEN="my-secret-token"
```

## Spawn commands directly

You can run arbitrary shell commands as agents:

```bash
go run ./cmd/cli-dm run \
  --agent "bash -c 'for i in $(seq 1 10); do echo Read src/app.ts; sleep 1; done'" \
  --agent "bash -c 'npm test; sleep 2; echo Done'" \
  --port 8420
```

Use `--adapter claude` when the output should be interpreted with Claude-oriented patterns:

```bash
go run ./cmd/cli-dm run --adapter claude --agent "claude -p 'Review this repo'"
```

## Config reference

Top-level config fields:

| Field | Description |
| --- | --- |
| `adapter` | Parser adapter. Supported values include `passthrough`, `claude`, and `stream-json`. |
| `port` | Backend HTTP/WebSocket port. Defaults to `8420`. |
| `agents` | Explicit agent definitions. |
| `sessions` | Session recording settings. |
| `hooks_auth` | Optional bearer token for hook events. |
| `watch_dir` | Parent directory to scan for active Claude Code sessions. |
| `watch_age` | Max age for auto-discovered sessions, such as `24h` or `7d`. |

Agent fields:

| Field | Description |
| --- | --- |
| `name` | Display name in the UI. |
| `role` | Sprite role: `warrior`, `rogue`, `mage`, `ranger`, `cleric`, or `bard`. |
| `source` | Event source: `pty`, `stream-json`, `hooks`, or `watch`. Defaults to `pty`. |
| `command` | Command to spawn for `pty` and `stream-json` sources. |
| `task` | Task or quest label shown in the DAG. |
| `depends_on` | Task labels that must precede this task. |
| `watch_file` | JSONL path for `source: watch`. |
| `project` | Project directory for auto-discovering Claude JSONL files. |

## Sessions

When session recording is enabled, `cli-dm` writes events and metadata under `~/.cli-dm/sessions`.

```yaml
sessions:
  enabled: true
  retention_days: 30
```

Manage recorded sessions:

```bash
go run ./cmd/cli-dm sessions list
go run ./cmd/cli-dm sessions search auth
go run ./cmd/cli-dm sessions show <session-id>
go run ./cmd/cli-dm sessions delete <session-id>
go run ./cmd/cli-dm sessions clean
```

Resume a previous session:

```bash
go run ./cmd/cli-dm run --resume <session-id>
```

## Build

Build backend and frontend:

```bash
make build
```

Build only the Go binary:

```bash
make build-go
```

Build only the web app:

```bash
make build-web
```

Run the built binary:

```bash
./bin/cli-dm run --config examples/dungeon.yaml
```

If `web/dist` exists, the Go server serves the built frontend. Otherwise, use the Vite dev server during development.

## Test

```bash
make test
```

This runs:

- `go test ./... -v`
- `cd web && npx tsc --noEmit`

## Architecture

```text
Claude Code / shell commands / hooks / JSONL files
        ↓
Go ingestion layer
        ↓
Parser adapters and Claude mappers
        ↓
Event protocol + session store
        ↓
WebSocket hub
        ↓
React + Pixi dungeon UI
```

Important paths:

- `cmd/cli-dm/main.go`: CLI commands and server wiring
- `internal/ingestion/`: PTY, hook, watcher, and discovery flows
- `internal/mapper/`: Claude output and JSONL mapping
- `internal/protocol/`: event model
- `internal/storage/`: recorded sessions
- `internal/server/`: WebSocket and static serving
- `protocol/events.schema.json`: event protocol schema
- `web/src/`: React/Pixi UI

## Roadmap notes

Planning documents live in:

- `plan-2d-grid-dungeon.md`
- `plans/proactive-features-and-macos-app.md`

## License

No license has been declared yet.
