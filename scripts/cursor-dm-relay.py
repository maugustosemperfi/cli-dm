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

# Close tail loops when JSONL stops updating — otherwise SubagentStop/Stop never fires.
_SUBAGENT_IDLE_SEC = int(os.environ.get("CLI_DM_SUBAGENT_IDLE_SEC", "120"))
_SESSION_IDLE_SEC = int(os.environ.get("CLI_DM_SESSION_IDLE_SEC", "600"))

# ---------------------------------------------------------------------------
# Discovery helpers
# ---------------------------------------------------------------------------

def _encode_cursor_path(path: str) -> str:
    """Reproduce Go's encodeCursorProjectPath — matches cli-dm's discover.go."""
    s = os.path.abspath(path).lstrip("/")
    return s.replace("/", "-").replace(".", "-")


def _find_session_jsonls(project_dir: str) -> list[Path]:
    """Return top-level session JSONLs in the project's agent-transcripts, newest first."""
    encoded = _encode_cursor_path(project_dir)
    root = Path.home() / ".cursor" / "projects" / encoded / "agent-transcripts"
    if not root.exists():
        print(f"[cursor-dm-relay] no agent-transcripts dir at {root}", file=sys.stderr)
        return []
    # top-level only: <uuid>/<uuid>.jsonl (not subagents)
    candidates = [p for p in root.glob("*/*.jsonl") if p.parent.parent == root]
    return sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True)


def _find_latest_jsonl(project_dir: str) -> Path | None:
    sessions = _find_session_jsonls(project_dir)
    return sessions[0] if sessions else None


def _session_id(p: Path) -> str:
    """UUID from the parent directory name."""
    return p.parent.name

def _hook_payload(session_id: str, **extra) -> dict:
    """Base hook payload — tags events as coming from Cursor."""
    return {"session_id": session_id, "source": "cursor", **extra}

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
    except Exception as exc:
        # Log auth/HTTP failures — silent swallow hid broken Cursor integration.
        if isinstance(exc, urllib.error.HTTPError) and exc.code == 401:
            print("[cursor-dm-relay] hook POST unauthorized — set CLI_DM_HOOK_TOKEN", file=sys.stderr)
        elif os.environ.get("CLI_DM_RELAY_DEBUG"):
            print(f"[cursor-dm-relay] hook POST failed: {exc}", file=sys.stderr)

# ---------------------------------------------------------------------------
# Core tail loop
# ---------------------------------------------------------------------------

def _relay_tool(session_id: str, name: str, tool_input: dict, tool_response: str = "", tool_use_id: str = "") -> None:
    """Emit PreToolUse + PostToolUse for one tool invocation."""
    base = _hook_payload(session_id, tool_name=name, tool_input=tool_input)
    if tool_use_id:
        base["tool_use_id"] = tool_use_id
    _post("PreToolUse", base)
    _post("PostToolUse", {**base, "tool_response": tool_response[:2000]})

def _peek_subagent_name(path: Path) -> str:
    """Read agentName/description from the first lines of a subagent transcript."""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for _ in range(30):
                line = f.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                for key in ("agentName", "agent_name", "description", "slug"):
                    val = entry.get(key)
                    if isinstance(val, str) and val.strip():
                        return val.strip()[:80]
    except OSError:
        pass
    return "subagent"


def _tail(path: Path, session_id: str, parent_id: str | None = None) -> None:
    """Tail a Cursor JSONL and relay tool events to /api/hooks.

    Cursor agent-transcripts record assistant tool_use blocks but do NOT persist
    user-side tool_result blocks (unlike Claude Code JSONL). Relay each tool_use
    immediately; still handle tool_result when present (Claude-style transcripts).
    """
    is_sub = parent_id is not None
    idle_sec = _SUBAGENT_IDLE_SEC if is_sub else _SESSION_IDLE_SEC

    if is_sub:
        sub_name = _peek_subagent_name(path)
        _post("SubagentStart", _hook_payload(
            session_id,
            parent_session_id=parent_id,
            agent_id=session_id,
            agent_name=sub_name,
        ))
    else:
        _post("SessionStart", _hook_payload(session_id))

    # pending[tool_use_id] = {name, input} — for Claude-style tool_result pairing
    pending: dict[str, dict] = {}
    relayed: set[str] = set()
    last_activity = time.time()

    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            # Seek to end — only tail new lines from here on
            f.seek(0, 2)

            while True:
                line = f.readline()
                if not line:
                    if time.time() - last_activity >= idle_sec:
                        break
                    time.sleep(0.2)
                    continue
                last_activity = time.time()
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
                    for bi, block in enumerate(content):
                        if not isinstance(block, dict):
                            continue
                        if block.get("type") != "tool_use":
                            continue
                        tid = block.get("id") or f"{hash(line)}:{bi}:{block.get('name', '')}"
                        if tid in relayed:
                            continue
                        relayed.add(tid)
                        tool = {
                            "name": block.get("name", ""),
                            "input": block.get("input", {}),
                        }
                        pending[tid] = tool
                        # Cursor transcripts omit tool_result — relay on tool_use.
                        _relay_tool(session_id, tool["name"], tool["input"], tool_use_id=tid)

                elif role == "user":
                    for block in content:
                        if not isinstance(block, dict):
                            continue
                        if block.get("type") != "tool_result":
                            continue
                        tid  = block.get("tool_use_id", "")
                        tool = pending.pop(tid, None)
                        if tool is None or tid in relayed:
                            continue
                        relayed.add(tid)

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
                        _post(event_type, _hook_payload(
                            session_id,
                            tool_name=tool["name"],
                            tool_input=tool["input"],
                            tool_response=str(result)[:2000],
                            tool_use_id=tid,
                        ))

    except (KeyboardInterrupt, SystemExit):
        pass

    finally:
        if is_sub:
            _post("SubagentStop", _hook_payload(session_id, agent_id=session_id))
        else:
            _post("Stop", _hook_payload(session_id))


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
        # Single explicit path — tail it once then exit.
        session_id = _session_id(explicit_path)
        print(f"[cursor-dm-relay] tailing {explicit_path} (session: {session_id})", file=sys.stderr)
        watcher = threading.Thread(target=_watch_subagents, args=(explicit_path.parent, session_id), daemon=True)
        watcher.start()

        def _handle_sig(sig, frame):
            _post("Stop", _hook_payload(session_id))
            sys.exit(0)
        signal.signal(signal.SIGTERM, _handle_sig)
        _tail(explicit_path, session_id)
        return

    # Auto-discover mode: poll for new Cursor sessions and tail each in the background.
    # Tails must not block discovery — otherwise a finished chat prevents picking up the next one.
    print(f"[cursor-dm-relay] watching {project} for Cursor sessions...", file=sys.stderr)
    seen: set[str] = set()

    def _handle_sig(sig, frame):
        sys.exit(0)
    signal.signal(signal.SIGTERM, _handle_sig)

    def _attach_session(path: Path) -> None:
        session_id = _session_id(path)
        print(f"[cursor-dm-relay] new session: {session_id}", file=sys.stderr)
        threading.Thread(
            target=_watch_subagents,
            args=(path.parent, session_id),
            daemon=True,
        ).start()
        threading.Thread(
            target=_tail,
            args=(path, session_id),
            daemon=True,
        ).start()

    while True:
        for path in _find_session_jsonls(project):
            session_id = _session_id(path)
            if session_id in seen:
                continue
            seen.add(session_id)
            _attach_session(path)
        time.sleep(2)


if __name__ == "__main__":
    main()
