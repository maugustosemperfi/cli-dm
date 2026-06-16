#!/usr/bin/env python3
"""cursor-dm-relay.py — tail Cursor JSONL transcript(s) and relay tool events to cli-dm.

Discovers the latest Cursor composer session for the project, tails it in real
time, and forwards tool events to cli-dm's /api/hooks endpoint using the same
wire format as the Claude Code hook relay (scripts/cli-dm-hook.sh).

Watches agent-transcripts/<uuid>/subagents/ for spawned subagents and relays
each one as SubagentStart / individual PostToolUse calls / SubagentStop.

Usage:
  python3 scripts/cursor-dm-relay.py                             # auto-discover (cwd)
  python3 scripts/cursor-dm-relay.py /path/to/session.jsonl     # explicit path
  python3 scripts/cursor-dm-relay.py --project /path/to/project # explicit project

Environment:
  CLI_DM_URL            Base URL of cli-dm  (default: http://localhost:8420)
  CLI_DM_HOOK_TOKEN     Bearer token — must match hooks_auth in dungeon-hooks.yaml
  CLI_DM_CURSOR_PROJECT Project directory for auto-discovery (default: cwd)
"""

from __future__ import annotations

import json
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_BASE_URL   = os.environ.get("CLI_DM_URL", "http://localhost:8420")
_TOKEN      = os.environ.get("CLI_DM_HOOK_TOKEN", "")
_PROJECT    = os.environ.get("CLI_DM_CURSOR_PROJECT", os.getcwd())

# ---------------------------------------------------------------------------
# Discovery helpers
# ---------------------------------------------------------------------------

def _encode_cursor_path(path: str) -> str:
    """Reproduce Go's encodeCursorProjectPath — matches cli-dm's discover.go."""
    s = os.path.abspath(path).lstrip("/")
    return s.replace("/", "-").replace(".", "-")


def _find_latest_jsonl(project_dir: str) -> Path | None:
    """Return the most recently modified top-level JSONL in the project's agent-transcripts."""
    encoded = _encode_cursor_path(project_dir)
    root = Path.home() / ".cursor" / "projects" / encoded / "agent-transcripts"
    if not root.exists():
        print(f"[cursor-dm-relay] no agent-transcripts dir at {root}", file=sys.stderr)
        return None
    # top-level only: <uuid>/<uuid>.jsonl (not subagents)
    candidates = [p for p in root.glob("*/*.jsonl") if p.parent.parent == root]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def _session_id(p: Path) -> str:
    """UUID from the parent directory name."""
    return p.parent.name

# ---------------------------------------------------------------------------
# HTTP relay (fire-and-forget, fail-safe)
# ---------------------------------------------------------------------------

def _post(hook_type: str, payload: dict) -> None:
    body = json.dumps({"hook_type": hook_type, "payload": payload}).encode()
    req = urllib.request.Request(
        f"{_BASE_URL}/api/hooks",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if _TOKEN:
        req.add_header("Authorization", f"Bearer {_TOKEN}")
    try:
        with urllib.request.urlopen(req, timeout=2) as r:
            r.read()
    except Exception:
        pass  # cli-dm down or unreachable — never block Cursor

# ---------------------------------------------------------------------------
# Core tail loop
# ---------------------------------------------------------------------------

def _tail(path: Path, session_id: str, parent_id: str | None = None) -> None:
    """Tail a Cursor JSONL, pair tool_use↔tool_result, relay to /api/hooks."""
    is_sub = parent_id is not None

    if is_sub:
        _post("SubagentStart", {
            "session_id": session_id,
            "parent_session_id": parent_id,
            "agent_id": session_id,
        })
    else:
        _post("SessionStart", {"session_id": session_id})

    # pending[tool_use_id] = {name, input}
    pending: dict[str, dict] = {}

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            # Seek to end — only tail new lines from here on
            f.seek(0, 2)

            while True:
                line = f.readline()
                if not line:
                    time.sleep(0.2)
                    continue
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue

                role = entry.get("role", "")
                msg  = entry.get("message")
                if not isinstance(msg, dict):
                    continue
                content = msg.get("content", [])
                if not isinstance(content, list):
                    continue

                if role == "assistant":
                    for block in content:
                        if not isinstance(block, dict):
                            continue
                        if block.get("type") == "tool_use":
                            tid = block.get("id", "")
                            pending[tid] = {
                                "name":  block.get("name", ""),
                                "input": block.get("input", {}),
                            }

                elif role == "user":
                    for block in content:
                        if not isinstance(block, dict):
                            continue
                        if block.get("type") != "tool_result":
                            continue
                        tid  = block.get("tool_use_id", "")
                        tool = pending.pop(tid, None)
                        if tool is None:
                            continue

                        # Normalise result to string
                        result = block.get("content", "")
                        if isinstance(result, list):
                            result = " ".join(
                                b.get("text", "") for b in result
                                if isinstance(b, dict) and b.get("type") == "text"
                            )

                        event_type = (
                            "PostToolUseFailure" if block.get("is_error") else "PostToolUse"
                        )
                        _post(event_type, {
                            "session_id":    session_id,
                            "tool_name":     tool["name"],
                            "tool_input":    tool["input"],
                            "tool_response": str(result)[:2000],
                        })

    except (KeyboardInterrupt, SystemExit):
        pass

    finally:
        if is_sub:
            _post("SubagentStop", {"session_id": session_id, "agent_id": session_id})
        else:
            _post("Stop", {"session_id": session_id})


def _watch_subagents(session_dir: Path, parent_id: str) -> None:
    """Spin up a _tail thread for each new subagent JSONL that appears."""
    subdir = session_dir / "subagents"
    seen: set[str] = set()
    while True:
        if subdir.exists():
            for p in subdir.glob("*.jsonl"):
                key = p.name
                if key not in seen:
                    seen.add(key)
                    sub_id = p.stem
                    t = threading.Thread(
                        target=_tail,
                        args=(p, sub_id, parent_id),
                        daemon=True,
                    )
                    t.start()
                    print(f"[cursor-dm-relay] subagent attached: {sub_id}", file=sys.stderr)
        time.sleep(1)

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    # Parse args
    args = sys.argv[1:]
    explicit_path: Path | None = None
    project = _PROJECT

    i = 0
    while i < len(args):
        if args[i] == "--project" and i + 1 < len(args):
            project = args[i + 1]
            i += 2
        elif not args[i].startswith("-"):
            explicit_path = Path(args[i])
            i += 1
        else:
            i += 1

    if explicit_path:
        path = explicit_path
    else:
        # Wait up to 30s for a session to appear (Cursor may not have started yet)
        path = None
        deadline = time.time() + 30
        while path is None and time.time() < deadline:
            path = _find_latest_jsonl(project)
            if path is None:
                print("[cursor-dm-relay] waiting for Cursor session...", file=sys.stderr)
                time.sleep(2)

    if path is None:
        print("[cursor-dm-relay] no Cursor JSONL found — exiting", file=sys.stderr)
        sys.exit(1)

    session_id = _session_id(path)
    print(f"[cursor-dm-relay] tailing {path} (session: {session_id})", file=sys.stderr)

    # Watch subagents in background
    watcher = threading.Thread(
        target=_watch_subagents,
        args=(path.parent, session_id),
        daemon=True,
    )
    watcher.start()

    # Handle SIGTERM gracefully (send Stop before exit)
    def _handle_sig(sig, frame):
        _post("Stop", {"session_id": session_id})
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_sig)

    # Tail main session (blocks until KeyboardInterrupt or SIGTERM)
    _tail(path, session_id)


if __name__ == "__main__":
    main()
