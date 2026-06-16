import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";
import type { TranscriptEntry } from "../../stores/gameState";
import { deriveTranscript } from "../../stores/deriveViews";
import { SearchBar } from "./SearchBar";
import { VirtualList } from "../VirtualList";

const FEED_ROW_HEIGHT = 20;

// ── helpers ─────────────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

interface KindMeta {
  icon: string;
  color: string;
  borderColor: string;
}

const KIND_META: Record<TranscriptEntry["kind"], KindMeta> = {
  tool_start: { icon: ">", color: "#5b8abf", borderColor: "#5b8abf" },
  tool_end:   { icon: "<", color: "#5baf7b", borderColor: "#5baf7b" },
  thinking:   { icon: "~", color: "#8b9aab", borderColor: "#8b9aab" },
  error:      { icon: "!", color: "#bf6b5b", borderColor: "#bf6b5b" },
  complete:   { icon: "✓", color: "#5baf7b", borderColor: "#5baf7b" },
  spawn:      { icon: "+", color: "#8b6baf", borderColor: "#8b6baf" },
  blocked:    { icon: "X", color: "#bfa85b", borderColor: "#bfa85b" },
};

function entryMessage(entry: TranscriptEntry): { text: string; dim: boolean } {
  switch (entry.kind) {
    case "tool_start":
      if (entry.action && entry.detail) {
        return { text: `${entry.action}: ${entry.detail}`, dim: false };
      }
      if (entry.action) {
        return { text: entry.action, dim: false };
      }
      return { text: entry.message ?? "", dim: false };

    case "tool_end":
      // Raw output lines: show the detail text directly
      if (entry.action === "stdout" || entry.action === "stderr") {
        return { text: entry.detail ?? "", dim: false };
      }
      return {
        text: entry.action ? `${entry.action} completed` : "completed",
        dim: true,
      };

    case "error":
    case "complete":
    case "spawn":
    case "blocked":
    case "thinking":
    default:
      return { text: entry.message ?? entry.detail ?? "", dim: false };
  }
}

// ── sub-components ───────────────────────────────────────────────────────────

// Highlight matching text within a string
function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span style={{ background: "#fff3cd", color: "#3e2723", borderRadius: 2, padding: "0 1px" }}>
        {text.slice(idx, idx + query.length)}
      </span>
      {text.slice(idx + query.length)}
    </>
  );
}

interface FeedRowProps {
  entry: TranscriptEntry;
  index: number;
  searchQuery?: string;
  isMatch?: boolean;
  onJump?: () => void;
}

function FeedRow({ entry, index, searchQuery, isMatch, onJump }: FeedRowProps) {
  const baseMeta = KIND_META[entry.kind] ?? KIND_META.thinking;
  const { text, dim } = entryMessage(entry);
  const roleColor = AGENT_COLORS[entry.agentRole ?? ""] ?? "#8b9aab";

  // Override icon and color for raw output lines
  const isStdout = entry.action === "stdout";
  const isStderr = entry.action === "stderr";
  const meta = isStdout
    ? { ...baseMeta, icon: "$", color: "#9a9da1", borderColor: baseMeta.borderColor }
    : isStderr
    ? { ...baseMeta, icon: "!", color: "#bf6b5b", borderColor: baseMeta.borderColor }
    : baseMeta;
  const textColor = isStdout ? "#9a9da1" : isStderr ? "#bf6b5b" : dim ? "#6d6f78" : "#dbdee1";

  const rowBg = isMatch
    ? "rgba(255,243,205,0.08)"
    : index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "2px 8px",
        borderLeft: `2px solid ${isMatch ? "#bfa85b" : meta.borderColor}`,
        background: rowBg,
        fontFamily: "monospace",
        gap: 6,
        minHeight: 18,
        boxSizing: "border-box",
      }}
    >
      {/* timestamp */}
      <span
        style={{
          fontSize: 9,
          color: "#6d6f78",
          width: 52,
          flexShrink: 0,
          userSelect: "none",
        }}
      >
        {formatTs(entry.ts)}
      </span>

      {/* agent dot */}
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: roleColor,
          flexShrink: 0,
          display: "inline-block",
        }}
      />

      {/* kind icon */}
      <span
        style={{
          fontSize: 10,
          color: meta.color,
          width: 10,
          textAlign: "center",
          flexShrink: 0,
          fontWeight: "bold",
        }}
      >
        {meta.icon}
      </span>

      {/* message */}
      <span
        style={{
          fontSize: 11,
          color: textColor,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
        }}
      >
        {searchQuery ? highlightText(text, searchQuery) : text}
      </span>

      {/* jump to map button */}
      {onJump && (
        <button
          onClick={(e) => { e.stopPropagation(); onJump(); }}
          title="Jump to room on map"
          style={{
            background: "none",
            border: "1px solid #3f4147",
            borderRadius: 3,
            color: "#5b8abf",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 9,
            padding: "0 4px",
            lineHeight: 1.4,
            flexShrink: 0,
          }}
        >
          &gt;
        </button>
      )}
    </div>
  );
}

// ── filter tabs ──────────────────────────────────────────────────────────────

const ALL_ROLES = ["warrior", "rogue", "mage", "ranger", "cleric", "bard"];

interface FilterTabsProps {
  agents: Map<string, { name: string; role: string; agentId: string }>;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

function FilterTabs({ agents, selected, onSelect }: FilterTabsProps) {
  // Build unique list of existing agents, preserving role order
  const agentList = ALL_ROLES.flatMap((role) => {
    const matches: { agentId: string; name: string; role: string }[] = [];
    for (const a of agents.values()) {
      if (a.role === role) matches.push(a);
    }
    return matches;
  });

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 4,
        padding: "5px 8px",
        background: "#1e1f22",
        borderBottom: "1px solid #3f4147",
        flexShrink: 0,
      }}
    >
      {/* All tab */}
      <button
        onClick={() => onSelect(null)}
        style={{
          fontSize: 10,
          padding: "2px 7px",
          borderRadius: 3,
          border: "1px solid",
          borderColor: selected === null ? "#5b8abf" : "#3f4147",
          background: selected === null ? "rgba(91,138,191,0.15)" : "transparent",
          color: selected === null ? "#a0c4f0" : "#8b9aab",
          cursor: "pointer",
          fontFamily: "monospace",
          lineHeight: 1.4,
        }}
      >
        All
      </button>

      {agentList.map((a) => {
        const dotColor = AGENT_COLORS[a.role] ?? "#8b9aab";
        const isActive = selected === a.agentId;
        return (
          <button
            key={a.agentId}
            onClick={() => onSelect(a.agentId)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              padding: "2px 7px",
              borderRadius: 3,
              border: "1px solid",
              borderColor: isActive ? dotColor : "#3f4147",
              background: isActive
                ? `${dotColor}26` // ~15% opacity
                : "transparent",
              color: isActive ? "#dbdee1" : "#8b9aab",
              cursor: "pointer",
              fontFamily: "monospace",
              lineHeight: 1.4,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: dotColor,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            {a.name}
          </button>
        );
      })}
    </div>
  );
}

// ── main component ───────────────────────────────────────────────────────────

export function LiveFeed() {
  const eventRingVersion = useGameState((s) => s.eventRingVersion);
  const eventRing = useGameState((s) => s.eventRing);
  const agents = useGameState((s) => s.agents);
  const dag = useGameState((s) => s.dag);
  const selectedAgent = useGameState((s) => s.selectedAgent);
  const selectAgent = useGameState((s) => s.selectAgent);
  const searchQuery = useGameState((s) => s.searchQuery);
  const searchFilters = useGameState((s) => s.searchFilters);
  const getFilteredTranscript = useGameState((s) => s.getFilteredTranscript);
  const focusOnNode = useGameState((s) => s.focusOnNode);

  const transcript = useMemo(
    () => deriveTranscript(eventRing, agents),
    [eventRing, eventRingVersion, agents]
  );

  const feedRef = useRef<HTMLDivElement>(null);
  const [nearBottom, setNearBottom] = useState(true);
  const [hasNew, setHasNew] = useState(false);

  const hasActiveSearch = searchQuery.trim() !== "" ||
    searchFilters.agentIds.length > 0 ||
    searchFilters.actionTypes.length > 0 ||
    searchFilters.timeRange !== "all";

  // Build match set for highlighting
  const filteredSet = useMemo(() => {
    if (!hasActiveSearch) return null;
    const filtered = getFilteredTranscript();
    return new Set(filtered.map((e) => `${e.ts}-${e.agentId}`));
  }, [hasActiveSearch, getFilteredTranscript, transcript, searchQuery, searchFilters]);

  const matchCount = filteredSet?.size ?? 0;

  // Jump to room on map for a given agent
  const jumpToAgent = useCallback(
    (agentId: string) => {
      const node = dag.nodes.find((n) => n.assignee === agentId);
      if (node) focusOnNode(node.nodeId);
    },
    [dag, focusOnNode]
  );

  // Filtered entries (agent tab filter still applies on top)
  const entries = selectedAgent
    ? transcript.filter((e) => e.agentId === selectedAgent)
    : transcript;

  const handleScroll = useCallback((isNearBottom: boolean) => {
    setNearBottom(isNearBottom);
    if (isNearBottom) setHasNew(false);
  }, []);

  // Auto-scroll when new entries arrive, if near bottom
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
      setHasNew(false);
    } else {
      setHasNew(true);
    }
  }, [entries.length, nearBottom]);

  const scrollToBottom = () => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setNearBottom(true);
    setHasNew(false);
  };

  const renderFeedRow = useCallback(
    (entry: TranscriptEntry, i: number) => {
      const entryKey = `${entry.ts}-${entry.agentId}`;
      const isMatch = filteredSet ? filteredSet.has(entryKey) : false;
      return (
        <FeedRow
          entry={entry}
          index={i}
          searchQuery={hasActiveSearch ? searchQuery : undefined}
          isMatch={hasActiveSearch ? isMatch : undefined}
          onJump={entry.agentId ? () => jumpToAgent(entry.agentId) : undefined}
        />
      );
    },
    [filteredSet, hasActiveSearch, searchQuery, jumpToAgent]
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* search bar */}
      <SearchBar matchCount={matchCount} />

      {/* filter tabs */}
      <FilterTabs
        agents={agents}
        selected={selectedAgent}
        onSelect={selectAgent}
      />

      {/* scrolling feed — windowed for long sessions */}
      <VirtualList
        scrollRef={feedRef}
        items={entries}
        itemHeight={FEED_ROW_HEIGHT}
        onScroll={handleScroll}
        getItemKey={(entry, i) => `${entry.ts}-${entry.agentId}-${i}`}
        renderItem={renderFeedRow}
        emptyMessage={
          <div
            style={{
              color: "#6d6f78",
              fontSize: 11,
              fontFamily: "monospace",
              padding: "12px 16px",
            }}
          >
            No activity yet…
          </div>
        }
      />

      {/* "new activity" floating button */}
      {hasNew && !nearBottom && (
        <button
          onClick={scrollToBottom}
          style={{
            position: "absolute",
            bottom: 10,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#5b8abf",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            padding: "3px 12px",
            fontSize: 10,
            fontFamily: "monospace",
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
            zIndex: 10,
            whiteSpace: "nowrap",
          }}
        >
          New activity ↓
        </button>
      )}
    </div>
  );
}
