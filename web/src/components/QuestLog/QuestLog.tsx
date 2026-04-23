import { useState, useEffect, useRef } from "react";
import { useGameState } from "../../stores/gameState";
import { narrativeEngine, type NarrativeEntry } from "./NarrativeEngine";
import { soundManager } from "../../audio/SoundManager";

export function QuestLog() {
  const [collapsed, setCollapsed] = useState(true);
  const [entries, setEntries] = useState<NarrativeEntry[]>([]);
  const [newEntryIds, setNewEntryIds] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const agents = useGameState((s) => s.agents);
  const dag = useGameState((s) => s.dag);

  // Process agent states each tick
  useEffect(() => {
    const newOnes = narrativeEngine.processAgentStates(agents, dag.nodes);
    if (newOnes.length > 0) {
      setEntries([...narrativeEngine.getEntries()]);
      setNewEntryIds((prev) => {
        const next = new Set(prev);
        for (const e of newOnes) next.add(e.id);
        return next;
      });
      // Fade out new markers after animation
      setTimeout(() => {
        setNewEntryIds((prev) => {
          const next = new Set(prev);
          for (const e of newOnes) next.delete(e.id);
          return next;
        });
      }, 1500);
    }
  }, [agents, dag]);

  // Auto-scroll to top (newest entries) when new ones arrive
  useEffect(() => {
    if (scrollRef.current && !collapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries, collapsed]);

  // Unread count (entries added while collapsed)
  const unreadCount = collapsed ? newEntryIds.size : 0;

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          position: "fixed",
          right: collapsed ? 12 : 312,
          top: 12,
          zIndex: 1000,
          background: "#5c3a1e",
          color: "#f4e8c1",
          border: "2px solid #8b6914",
          borderRadius: 6,
          padding: "6px 12px",
          cursor: "pointer",
          fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
          fontSize: 13,
          fontWeight: "bold",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          transition: "right 0.3s ease",
        }}
      >
        {collapsed ? "\u{1F4DC}" : "\u{2716}"} Quest Log
        {unreadCount > 0 && (
          <span
            style={{
              marginLeft: 6,
              background: "#bf6b5b",
              color: "#fff",
              borderRadius: 8,
              padding: "1px 6px",
              fontSize: 11,
            }}
          >
            {unreadCount}
          </span>
        )}
      </button>

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          right: collapsed ? -320 : 0,
          top: 0,
          width: 300,
          height: "100vh",
          zIndex: 999,
          background: "#f4e8c1",
          borderLeft: "3px solid #8b6914",
          boxShadow: collapsed ? "none" : "-4px 0 16px rgba(0,0,0,0.3)",
          transition: "right 0.3s ease",
          display: "flex",
          flexDirection: "column",
          fontFamily: "'Palatino Linotype', 'Book Antiqua', Palatino, serif",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 16px 10px",
            borderBottom: "2px solid #c4a35a",
            textAlign: "center",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              color: "#3e2723",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            Chronicles of the Dungeon
          </h2>
        </div>

        {/* Entries */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 12px",
          }}
        >
          {entries.length === 0 && (
            <p style={{ color: "#8b7355", fontStyle: "italic", textAlign: "center", marginTop: 40 }}>
              The chronicles are silent... for now.
            </p>
          )}
          {entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: "8px 10px",
                marginBottom: 6,
                borderLeft: "3px solid #c4a35a",
                background: newEntryIds.has(entry.id)
                  ? "rgba(139, 105, 20, 0.12)"
                  : "rgba(196, 163, 90, 0.06)",
                borderRadius: 4,
                animation: newEntryIds.has(entry.id) ? "questSlideIn 0.4s ease-out" : undefined,
                transition: "background 0.5s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{entry.icon}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, color: "#3e2723", fontSize: 13, lineHeight: 1.4 }}>
                    {entry.text}
                  </p>
                  <p style={{ margin: "3px 0 0", color: "#8b7355", fontSize: 10 }}>
                    {new Date(entry.ts).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Volume Controls */}
        <div
          style={{
            padding: "10px 14px",
            borderTop: "2px solid #c4a35a",
            background: "rgba(94, 58, 30, 0.08)",
          }}
        >
          <VolumeControls />
        </div>
      </div>

      {/* CSS animation keyframes */}
      <style>{`
        @keyframes questSlideIn {
          from {
            opacity: 0;
            transform: translateY(-12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </>
  );
}

function VolumeControls() {
  const [masterVol, setMasterVol] = useState(soundManager.getMasterVolume());

  return (
    <div style={{ fontSize: 12, color: "#3e2723" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ width: 60 }}>Volume</label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(masterVol * 100)}
          onChange={(e) => {
            const v = parseInt(e.target.value) / 100;
            setMasterVol(v);
            soundManager.setMasterVolume(v);
          }}
          style={{ flex: 1, accentColor: "#8b6914" }}
        />
        <span style={{ width: 30, textAlign: "right" }}>{Math.round(masterVol * 100)}%</span>
      </div>
    </div>
  );
}
