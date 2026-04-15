import { useEffect, useRef } from "react";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";
import type { TranscriptEntry } from "../../stores/gameState";

const KIND_ICONS: Record<string, string> = {
  tool_start: "\u2694",   // crossed swords
  tool_end: "\u2714",     // checkmark
  thinking: "\u2728",     // sparkles
  error: "\u26A0",        // warning
  complete: "\u2605",     // star
  spawn: "\u2192",        // arrow
  blocked: "\u26D4",      // no entry
};

const KIND_COLORS: Record<string, string> = {
  tool_start: "#5b8abf",
  tool_end: "#5baf7b",
  thinking: "#8b9aab",
  error: "#bf6b5b",
  complete: "#5baf7b",
  spawn: "#8b6baf",
  blocked: "#bfa85b",
};

const ACTION_LABELS: Record<string, string> = {
  read: "Reading scroll",
  edit: "Inscribing runes",
  test: "Combat trial",
  build: "Forging artifact",
  git: "Time magic",
  shell: "Casting spell",
  network: "Summoning",
  thinking: "Pondering",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatEntry(entry: TranscriptEntry): string {
  switch (entry.kind) {
    case "tool_start":
      return `${ACTION_LABELS[entry.action ?? ""] ?? entry.action}${entry.detail ? ` — ${entry.detail}` : ""}`;
    case "tool_end":
      return `Completed ${entry.action ?? "action"}${entry.detail ? ` (${entry.detail})` : ""}`;
    case "thinking":
      return entry.detail ?? "Deep in thought...";
    case "error":
      return entry.message ?? "Hit an error";
    case "complete":
      return entry.message ?? "Quest complete!";
    case "spawn":
      return entry.message ?? "Joined the dungeon";
    case "blocked":
      return `Blocked: ${entry.detail ?? "unknown"}`;
    default:
      return entry.message ?? "";
  }
}

function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  const agentColor = entry.agentRole ? AGENT_COLORS[entry.agentRole] ?? "#8b9aab" : "#8b9aab";
  const kindColor = KIND_COLORS[entry.kind] ?? "#8b9aab";
  const icon = KIND_ICONS[entry.kind] ?? "\u2022";
  const isToolCall = entry.kind === "tool_start";

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        padding: "4px 8px",
        fontSize: 11,
        fontFamily: "monospace",
        borderLeft: `2px solid ${kindColor}`,
        marginBottom: 1,
        background: isToolCall ? "rgba(91, 138, 191, 0.05)" : "transparent",
      }}
    >
      <span style={{ color: "#6d6f78", flexShrink: 0, width: 52 }}>
        {formatTime(entry.ts)}
      </span>
      <span style={{ flexShrink: 0, width: 14, textAlign: "center" }}>
        {icon}
      </span>
      {entry.agentName && (
        <span style={{ color: agentColor, fontWeight: "bold", flexShrink: 0, minWidth: 70, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {entry.agentName}
        </span>
      )}
      <span
        style={{
          color: entry.kind === "error" ? "#bf6b5b" : "#dbdee1",
          fontStyle: entry.kind === "thinking" ? "italic" : "normal",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {formatEntry(entry)}
      </span>
    </div>
  );
}

export function Transcript() {
  const transcript = useGameState((s) => s.transcript);
  const selectedAgent = useGameState((s) => s.selectedAgent);
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolledRef = useRef(true);

  // Filter by selected agent if any
  const filtered = selectedAgent
    ? transcript.filter((e) => e.agentId === selectedAgent)
    : transcript;

  // Auto-scroll to bottom
  useEffect(() => {
    const el = containerRef.current;
    if (el && isScrolledRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [filtered]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    isScrolledRef.current = nearBottom;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "6px 8px",
          fontFamily: "monospace",
          fontSize: 12,
          color: "#8b9aab",
          borderBottom: "1px solid #3f4147",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>
          Transcript
          {selectedAgent && (
            <span style={{ color: "#6d6f78" }}> (filtered)</span>
          )}
        </span>
        <span style={{ color: "#6d6f78" }}>
          {filtered.length} entries
        </span>
      </div>

      {/* Scrollable transcript */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              color: "#6d6f78",
              padding: 20,
              textAlign: "center",
              fontFamily: "monospace",
              fontSize: 12,
            }}
          >
            {selectedAgent ? "No activity for selected agent..." : "Waiting for agent activity..."}
          </div>
        ) : (
          filtered.map((entry, i) => <TranscriptRow key={i} entry={entry} />)
        )}
      </div>

      {/* Scroll to latest */}
      {!isScrolledRef.current && filtered.length > 0 && (
        <div
          onClick={() => {
            const el = containerRef.current;
            if (el) {
              el.scrollTop = el.scrollHeight;
              isScrolledRef.current = true;
            }
          }}
          style={{
            textAlign: "center",
            padding: "4px",
            background: "#2b2d31",
            borderTop: "1px solid #3f4147",
            color: "#5b8abf",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 11,
          }}
        >
          Scroll to latest
        </div>
      )}
    </div>
  );
}
