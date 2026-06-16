"""Tests for cli-dm MCP server tools (B2 spec verification)."""

from __future__ import annotations

import pytest
import respx
import httpx

import cli_dm_mcp.server as srv


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

EMPTY_SNAPSHOT = {"type": "state.snapshot", "agents": [], "dag": {"nodes": [], "edges": []}, "ts": 0}

POPULATED_SNAPSHOT = {
    "type": "state.snapshot",
    "agents": [
        {
            "agentId": "t1",
            "name": "Live Session",
            "role": "rogue",
            "currentAction": "read",
            "currentDetail": "src/main.go",
            "isBlocked": False,
            "isComplete": False,
        },
        {
            "agentId": "t2",
            "name": "Blocked Agent",
            "role": "warrior",
            "currentAction": "idle",
            "currentDetail": "waiting for t1",
            "isBlocked": True,
            "isComplete": False,
        },
    ],
    "dag": {
        "nodes": [
            {"nodeId": "task-1", "label": "Active Task", "status": "in_progress", "assignee": "t1"},
            {"nodeId": "task-2", "label": "Blocked Task", "status": "blocked", "assignee": "t2"},
        ],
        "edges": [{"from": "task-1", "to": "task-2"}],
    },
    "ts": 1718000000000,
}


@pytest.fixture(autouse=True)
def reset_config():
    """Restore module-level config vars after each test."""
    orig_url, orig_token = srv._base_url, srv._token
    yield
    srv._base_url = orig_url
    srv._token = orig_token


# ---------------------------------------------------------------------------
# B2-R5: empty dungeon returns empty arrays, not an error
# ---------------------------------------------------------------------------


@respx.mock
def test_snapshot_empty_dungeon():
    srv._base_url = "http://localhost:8420"
    respx.get("http://localhost:8420/api/snapshot").mock(
        return_value=httpx.Response(200, json=EMPTY_SNAPSHOT)
    )
    result = srv.dungeon_snapshot()
    assert result["agents"] == []
    assert result["dag"]["nodes"] == []
    assert result["dag"]["edges"] == []


@respx.mock
def test_blocked_empty_dungeon():
    srv._base_url = "http://localhost:8420"
    respx.get("http://localhost:8420/api/snapshot").mock(
        return_value=httpx.Response(200, json=EMPTY_SNAPSHOT)
    )
    result = srv.dungeon_blocked()
    assert result == []


@respx.mock
def test_dag_empty_dungeon():
    srv._base_url = "http://localhost:8420"
    respx.get("http://localhost:8420/api/snapshot").mock(
        return_value=httpx.Response(200, json=EMPTY_SNAPSHOT)
    )
    result = srv.dungeon_dag()
    assert result == {"nodes": [], "edges": []}


# ---------------------------------------------------------------------------
# B2-R3: dungeon_blocked returns only blocked agents
# ---------------------------------------------------------------------------


@respx.mock
def test_blocked_filters_correctly():
    srv._base_url = "http://localhost:8420"
    respx.get("http://localhost:8420/api/snapshot").mock(
        return_value=httpx.Response(200, json=POPULATED_SNAPSHOT)
    )
    result = srv.dungeon_blocked()
    assert isinstance(result, list)
    assert len(result) == 1
    assert result[0]["agent_id"] == "t2"
    assert result[0]["name"] == "Blocked Agent"


# ---------------------------------------------------------------------------
# B2-R4: dungeon_dag reflects live statuses and edges
# ---------------------------------------------------------------------------


@respx.mock
def test_dag_statuses_and_edges():
    srv._base_url = "http://localhost:8420"
    respx.get("http://localhost:8420/api/snapshot").mock(
        return_value=httpx.Response(200, json=POPULATED_SNAPSHOT)
    )
    result = srv.dungeon_dag()
    nodes = {n["nodeId"]: n["status"] for n in result["nodes"]}
    assert nodes["task-1"] == "in_progress"
    assert nodes["task-2"] == "blocked"
    assert result["edges"] == [{"from": "task-1", "to": "task-2"}]


# ---------------------------------------------------------------------------
# B2-R2: auth token forwarded; 401 surfaces as error
# ---------------------------------------------------------------------------


@respx.mock
def test_auth_token_forwarded():
    srv._base_url = "http://localhost:8420"
    srv._token = "dungeon-live-2026"

    def check_auth(request: httpx.Request) -> httpx.Response:
        assert request.headers.get("Authorization") == "Bearer dungeon-live-2026"
        return httpx.Response(200, json=EMPTY_SNAPSHOT)

    respx.get("http://localhost:8420/api/snapshot").mock(side_effect=check_auth)
    result = srv.dungeon_snapshot()
    assert "error" not in result


@respx.mock
def test_unauthorized_returns_error():
    srv._base_url = "http://localhost:8420"
    respx.get("http://localhost:8420/api/snapshot").mock(
        return_value=httpx.Response(401, text="unauthorized")
    )
    result = srv.dungeon_snapshot()
    assert "error" in result


# ---------------------------------------------------------------------------
# B2-R6: tools surface errors cleanly when cli-dm is unreachable
# ---------------------------------------------------------------------------


@respx.mock
def test_snapshot_unreachable():
    srv._base_url = "http://localhost:8420"
    respx.get("http://localhost:8420/api/snapshot").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    result = srv.dungeon_snapshot()
    assert "error" in result


@respx.mock
def test_blocked_unreachable():
    srv._base_url = "http://localhost:8420"
    respx.get("http://localhost:8420/api/snapshot").mock(
        side_effect=httpx.ConnectError("connection refused")
    )
    result = srv.dungeon_blocked()
    assert "error" in result
