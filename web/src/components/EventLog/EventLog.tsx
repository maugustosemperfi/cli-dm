import { useEffect, useRef } from "react";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";
import type { EventLogEntry } from "../../stores/gameState";

const TYPE_COLORS: Record<string, string> = {
  action: "#5b8abf",
  complete: "#5baf7b",
  error: "#bf6b5b",
  blocked: "#bfa85b",
  resolve: "#5baf7b",
  dag: "#4e5058",
  spawn: "#8b6baf",
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function EntryRow({ entry }: { entry: EventLogEntry }) {
  const agentColor = entry.agentRole ? AGENT_COLORS[entry.agentRole] ?? "#8b9aab" : "#8b9aab";
  const typeColor = TYPE_COLORS[entry.category] ?? "#8b9aab";

  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        padding: "3px 8px",
        fontSize: 11,
        fontFamily: "monospace",
        borderLeft: `2px solid ${typeColor}`,
        marginBottom: 1,
      }}
    >
      <span style={{ color: "#6d6f78", flexShrink: 0 }}>
        {formatTime(entry.ts)}
      </span>
      {entry.agentName && (
        <span style={{ color: agentColor, fontWeight: "bold", flexShrink: 0, minWidth: 80 }}>
          {entry.agentName}
        </span>
      )}
      <span style={{ color: typeColor === "#4e5058" ? "#6d6f78" : "#dbdee1" }}>
        {entry.message}
      </span>
    </div>
  );
}

export function EventLog() {
  const eventLog = useGameState((s) => s.eventLog);
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolledRef = useRef(true);

  // Auto-scroll to bottom unless user scrolled up
  useEffect(() => {
    const el = containerRef.current;
    if (el && isScrolledRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [eventLog]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
    isScrolledRef.current = nearBottom;
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
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
        <span>Event Log</span>
        <span style={{ color: "#6d6f78" }}>{eventLog.length} events</span>
      </div>

      {/* Scrollable log */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "4px 0",
        }}
      >
        {eventLog.length === 0 ? (
          <div
            style={{
              color: "#6d6f78",
              padding: 20,
              textAlign: "center",
              fontFamily: "monospace",
              fontSize: 12,
            }}
          >
            Waiting for events...
          </div>
        ) : (
          eventLog.map((entry, i) => <EntryRow key={i} entry={entry} />)
        )}
      </div>

      {/* Scroll lock indicator */}
      {!isScrolledRef.current && eventLog.length > 0 && (
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
