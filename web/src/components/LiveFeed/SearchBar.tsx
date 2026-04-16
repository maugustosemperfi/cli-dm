import { useState, useRef, useCallback, useEffect } from "react";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";
import type { SearchFilters } from "../../stores/gameState";

const ACTION_TYPES = ["read", "edit", "test", "build", "git", "shell", "error", "thinking"];

const TIME_RANGES: Array<{ label: string; value: SearchFilters["timeRange"] }> = [
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "All", value: "all" },
];

interface SearchBarProps {
  matchCount: number;
}

export function SearchBar({ matchCount }: SearchBarProps) {
  const agents = useGameState((s) => s.agents);
  const searchQuery = useGameState((s) => s.searchQuery);
  const searchFilters = useGameState((s) => s.searchFilters);
  const setSearchQuery = useGameState((s) => s.setSearchQuery);
  const setSearchFilters = useGameState((s) => s.setSearchFilters);

  const [expanded, setExpanded] = useState(false);
  const [localQuery, setLocalQuery] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search input
  const handleQueryChange = useCallback(
    (value: string) => {
      setLocalQuery(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setSearchQuery(value), 200);
    },
    [setSearchQuery]
  );

  // Cleanup debounce on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  const hasActiveSearch = searchQuery.trim() !== "" ||
    searchFilters.agentIds.length > 0 ||
    searchFilters.actionTypes.length > 0 ||
    searchFilters.timeRange !== "all";

  const clearAll = () => {
    setLocalQuery("");
    setSearchQuery("");
    setSearchFilters({ agentIds: [], actionTypes: [], timeRange: "all" });
  };

  const toggleAgent = (agentId: string) => {
    const ids = searchFilters.agentIds.includes(agentId)
      ? searchFilters.agentIds.filter((id) => id !== agentId)
      : [...searchFilters.agentIds, agentId];
    setSearchFilters({ agentIds: ids });
  };

  const toggleAction = (action: string) => {
    const types = searchFilters.actionTypes.includes(action)
      ? searchFilters.actionTypes.filter((a) => a !== action)
      : [...searchFilters.actionTypes, action];
    setSearchFilters({ actionTypes: types });
  };

  return (
    <div
      style={{
        background: "#1e1f22",
        borderBottom: "1px solid #3f4147",
        flexShrink: 0,
      }}
    >
      {/* Search input row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 6px",
        }}
      >
        <input
          type="text"
          value={localQuery}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Search events..."
          style={{
            flex: 1,
            background: "#f4e8c1",
            border: "1px solid #8b7355",
            borderRadius: 3,
            padding: "3px 6px",
            fontSize: 10,
            fontFamily: "monospace",
            color: "#3e2723",
            outline: "none",
            minWidth: 0,
          }}
        />
        <button
          onClick={() => setExpanded(!expanded)}
          title="Filters"
          style={{
            background: expanded ? "rgba(91,138,191,0.15)" : "none",
            border: `1px solid ${expanded ? "#5b8abf" : "#3f4147"}`,
            borderRadius: 3,
            color: expanded ? "#a0c4f0" : "#8b9aab",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 10,
            padding: "2px 6px",
            lineHeight: 1.4,
            flexShrink: 0,
          }}
        >
          {expanded ? "^" : "v"}
        </button>
        {hasActiveSearch && (
          <button
            onClick={clearAll}
            title="Clear search"
            style={{
              background: "none",
              border: "1px solid #3f4147",
              borderRadius: 3,
              color: "#bf6b5b",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: 10,
              padding: "2px 6px",
              lineHeight: 1.4,
              flexShrink: 0,
            }}
          >
            x
          </button>
        )}
        {hasActiveSearch && (
          <span
            style={{
              fontSize: 9,
              color: "#bfa85b",
              fontFamily: "monospace",
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {matchCount} match{matchCount !== 1 ? "es" : ""}
          </span>
        )}
      </div>

      {/* Collapsible filter panel */}
      {expanded && (
        <div
          style={{
            padding: "4px 6px 6px",
            borderTop: "1px solid #2b2d31",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {/* Agent filter */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "#6d6f78", fontFamily: "monospace", width: 40, flexShrink: 0 }}>
              Agent:
            </span>
            {[...agents.values()].map((a) => {
              const active = searchFilters.agentIds.includes(a.agentId);
              const color = AGENT_COLORS[a.role] ?? "#8b9aab";
              return (
                <button
                  key={a.agentId}
                  onClick={() => toggleAgent(a.agentId)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    fontSize: 9,
                    padding: "1px 5px",
                    borderRadius: 3,
                    border: `1px solid ${active ? color : "#3f4147"}`,
                    background: active ? `${color}26` : "transparent",
                    color: active ? "#dbdee1" : "#6d6f78",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: color,
                      display: "inline-block",
                    }}
                  />
                  {a.name}
                </button>
              );
            })}
          </div>

          {/* Action type filter */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "#6d6f78", fontFamily: "monospace", width: 40, flexShrink: 0 }}>
              Type:
            </span>
            {ACTION_TYPES.map((action) => {
              const active = searchFilters.actionTypes.includes(action);
              return (
                <button
                  key={action}
                  onClick={() => toggleAction(action)}
                  style={{
                    fontSize: 9,
                    padding: "1px 5px",
                    borderRadius: 3,
                    border: `1px solid ${active ? "#5b8abf" : "#3f4147"}`,
                    background: active ? "rgba(91,138,191,0.15)" : "transparent",
                    color: active ? "#a0c4f0" : "#6d6f78",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    lineHeight: 1.4,
                  }}
                >
                  {action}
                </button>
              );
            })}
          </div>

          {/* Time range */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "#6d6f78", fontFamily: "monospace", width: 40, flexShrink: 0 }}>
              Time:
            </span>
            {TIME_RANGES.map((tr) => {
              const active = searchFilters.timeRange === tr.value;
              return (
                <button
                  key={tr.value}
                  onClick={() => setSearchFilters({ timeRange: tr.value })}
                  style={{
                    fontSize: 9,
                    padding: "1px 5px",
                    borderRadius: 3,
                    border: `1px solid ${active ? "#5b8abf" : "#3f4147"}`,
                    background: active ? "rgba(91,138,191,0.15)" : "transparent",
                    color: active ? "#a0c4f0" : "#6d6f78",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    lineHeight: 1.4,
                  }}
                >
                  {tr.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
