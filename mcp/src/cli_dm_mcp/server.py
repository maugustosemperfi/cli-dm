"""cli-dm MCP server — read-only control plane over a running cli-dm instance.

Exposes 3 tools that query GET /api/snapshot and filter the result.

Environment:
    CLI_DM_URL          Base URL of the cli-dm server (default: http://localhost:8420)
    CLI_DM_HOOK_TOKEN   Bearer token (must match hooks_auth in dungeon-hooks.yaml)

Start with:  uv run cli-dm-mcp   (stdio transport, default for Claude Code MCP)
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("cli-dm")

# ---------------------------------------------------------------------------
# Config — read once at import time; overridable in tests via module attrs.
# ---------------------------------------------------------------------------

_base_url: str = os.environ.get("CLI_DM_URL", "http://localhost:8420")
_token: str = os.environ.get("CLI_DM_HOOK_TOKEN", "")


def _headers() -> dict[str, str]:
    h: dict[str, str] = {}
    if _token:
        h["Authorization"] = f"Bearer {_token}"
    return h


def _fetch_snapshot() -> dict[str, Any]:
    """Fetch the current StateSnapshot from cli-dm. Raises on HTTP/network error."""
    with httpx.Client(timeout=5.0) as client:
        resp = client.get(f"{_base_url}/api/snapshot", headers=_headers())
        resp.raise_for_status()
        return resp.json()


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@mcp.tool()
def dungeon_snapshot() -> dict[str, Any]:
    """Return the full current state of the dungeon.

    Includes all agents (id, name, role, current action, blocked/complete flags)
    and the task DAG (nodes with status + dependency edges).

    Returns the raw StateSnapshot JSON or {error: ...} on failure.
    """
    try:
        return _fetch_snapshot()
    except Exception as exc:
        return {"error": str(exc)}


@mcp.tool()
def dungeon_blocked() -> list[dict[str, Any]] | dict[str, Any]:
    """Return agents that are currently blocked.

    Each entry: {agent_id, name, role, current_action, current_detail}.
    Returns an empty list when no agent is blocked.
    Returns {error: ...} on failure.
    """
    try:
        snap = _fetch_snapshot()
        return [
            {
                "agent_id": a["agentId"],
                "name": a.get("name", ""),
                "role": a.get("role", ""),
                "current_action": a.get("currentAction", ""),
                "current_detail": a.get("currentDetail", ""),
            }
            for a in snap.get("agents", [])
            if a.get("isBlocked", False)
        ]
    except Exception as exc:
        return {"error": str(exc)}


@mcp.tool()
def dungeon_dag() -> dict[str, Any]:
    """Return the live task DAG with per-node statuses and dependency edges.

    Nodes include: {node_id, label, status, assignee}.
    Edges include: {from, to}.
    Status values: pending | in_progress | completed | failed | blocked.
    Returns {nodes: [], edges: []} when the dungeon is empty.
    Returns {error: ...} on failure.
    """
    try:
        snap = _fetch_snapshot()
        dag = snap.get("dag", {})
        return {
            "nodes": dag.get("nodes", []),
            "edges": dag.get("edges", []),
        }
    except Exception as exc:
        return {"error": str(exc)}


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
