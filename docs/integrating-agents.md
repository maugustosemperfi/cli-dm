# Integrating any AI agent with cli-dm

cli-dm visualizes agent activity in real time. Any tool that can execute a shell script on
tool events can feed it — Claude Code, Cursor, Codex, or a custom agent pipeline.

## How it works

```
Your agent session
   └─ fires a hook event (PreToolUse, PostToolUse, etc.)
       └─ runs scripts/cli-dm-hook.sh
           └─ POSTs to http://localhost:8420/api/hooks
               └─ cli-dm broadcasts the event to the browser via WebSocket
```

## Step 1: Start cli-dm with the hooks config

```bash
export CLI_DM_HOOK_TOKEN=dungeon-live-2026   # must match hooks_auth in dungeon-hooks.yaml
make dev-hooks                               # starts Go backend + Vite frontend
```

Open http://localhost:5173 (dev) or http://localhost:8420 (built).

## Step 2: Wire your agent

### Claude Code

Already wired via `~/.claude/settings.json`. The hooks fire automatically for every session.
The relay script is `scripts/cli-dm-hook.sh`.

### Cursor

Cursor doesn't have a built-in hook system, but you can wrap your AI commands or use
Cursor's `task` runner. The simplest approach is a wrapper script:

```bash
#!/bin/bash
# cursor-dm-proxy.sh — wrap any command and notify cli-dm on start/end
export CLI_DM_HOOK_TOKEN=dungeon-live-2026

# Notify start
echo '{"session_id":"cursor-'$$'","model":"cursor"}' \
  | /path/to/cli-dm/scripts/cli-dm-hook.sh SessionStart

# Run the real command
"$@"
EXIT=$?

# Notify end
echo '{"session_id":"cursor-'$$'"}' \
  | /path/to/cli-dm/scripts/cli-dm-hook.sh Stop

exit $EXIT
```

For per-tool granularity, Cursor's "Background agents" can emit hooks via their
`onBeforeEdit` / `onAfterEdit` callbacks — pipe those events to the relay in the same format.

### OpenAI Codex / any OpenAI-compatible agent

The relay accepts a generic JSON envelope:

```json
{
  "hook_type": "PostToolUse",
  "payload": {
    "session_id": "my-agent-session-42",
    "tool_name": "write_file",
    "tool_input": { "path": "src/main.py" },
    "tool_response": "ok"
  }
}
```

Call the relay directly from your agent code:

```python
import subprocess, json, os

def notify_cli_dm(hook_type: str, payload: dict):
    env = os.environ.copy()
    env["CLI_DM_HOOK_TOKEN"] = "dungeon-live-2026"
    proc = subprocess.Popen(
        ["/path/to/cli-dm/scripts/cli-dm-hook.sh", hook_type],
        stdin=subprocess.PIPE,
        env=env,
    )
    proc.stdin.write(json.dumps(payload).encode())
    proc.stdin.close()
    # don't wait — fire and forget
```

Or POST directly with curl / any HTTP client:

```bash
curl -s -X POST http://localhost:8420/api/hooks \
  -H "Authorization: Bearer dungeon-live-2026" \
  -H "Content-Type: application/json" \
  -d '{"hook_type":"PostToolUse","payload":{"session_id":"my-session","tool_name":"bash"}}'
```

### Custom / headless agent

Any process can drive cli-dm. Minimum viable payload per hook type:

| hook_type       | Required payload fields                          |
|-----------------|--------------------------------------------------|
| `SessionStart`  | `session_id`, optionally `model`                 |
| `PreToolUse`    | `session_id`, `tool_name`, `tool_input`          |
| `PostToolUse`   | `session_id`, `tool_name`, `tool_response`       |
| `SubagentStart` | `session_id`, `parent_session_id` (optional)     |
| `SubagentStop`  | `session_id`                                     |
| `Stop`          | `session_id`                                     |

## Step 3: Configure the token

The relay reads `CLI_DM_HOOK_TOKEN` from the environment. The server reads `hooks_auth` from
`dungeon-hooks.yaml`. They must match.

```bash
# In your shell profile (.zshrc / .bashrc):
export CLI_DM_HOOK_TOKEN=dungeon-live-2026
```

To disable auth (dev only), leave `hooks_auth` blank in the yaml and unset the env var.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Nothing appears in the dungeon | Check cli-dm is running with `dungeon-hooks.yaml` (not `dungeon.yaml`) — look for `hook receiver mounted` in the Go log |
| 401 errors in relay output | Token mismatch — `CLI_DM_HOOK_TOKEN` must equal `hooks_auth` in `dungeon-hooks.yaml` |
| Agent appears but doesn't animate | The `session_id` in payloads must be stable across calls for the same agent session |
| Relay hangs | Shouldn't happen — the relay backgrounds curl with `&` and caps at `--max-time 2` |
