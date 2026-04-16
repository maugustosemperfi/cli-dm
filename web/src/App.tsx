import { createContext, useContext, useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { DungeonMap } from "./components/DungeonMap/DungeonMap";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { Timeline } from "./components/Timeline/Timeline";
import { AgentSidebar } from "./components/AgentSidebar/AgentSidebar";
import { LiveFeed } from "./components/LiveFeed/LiveFeed";
import { ScoreScreen } from "./components/ScoreScreen/ScoreScreen";
import { QuestLog } from "./components/QuestLog/QuestLog";
import { CommandPalette } from "./components/DungeonMap/CommandPalette";
import { WorldMap } from "./components/WorldMap/WorldMap";
import { useWorldState } from "./stores/worldState";

const WS_URL =
  import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}/api/ws`;

type SendCommandFn = (type: string, payload: Record<string, unknown>) => void;
export const CommandContext = createContext<SendCommandFn>(() => {});
export const useCommand = () => useContext(CommandContext);

export function App() {
  const { sendCommand } = useWebSocket({ url: WS_URL });

  // Load persistent world state on mount
  const loadFromStorage = useWorldState((s) => s.loadFromStorage);
  const addSession = useWorldState((s) => s.addSession);
  const setCurrentSession = useWorldState((s) => s.setCurrentSession);

  // Initialize world state from localStorage
  useState(() => {
    loadFromStorage();
    // Register current session
    const sessionId = `session-${Date.now()}`;
    setCurrentSession(sessionId);
    addSession({
      sessionId,
      name: document.title || "Current Session",
      startedAt: Date.now(),
      endedAt: 0,
      agentCount: 0,
      taskCount: 0,
      status: "running",
      worldX: 0,
      worldY: 0,
      totalXP: 0,
      totalGold: 0,
      totalTokens: 0,
    });
  });

  return (
    <CommandContext.Provider value={sendCommand}>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "65fr 35fr",
        gridTemplateRows: "1fr 280px auto",
        height: "100vh",
        background: "#2b2d31",
        color: "#dbdee1",
      }}
    >
      {/* Top-left: Dungeon Map */}
      <div
        style={{
          borderRight: "1px solid #3f4147",
          borderBottom: "1px solid #3f4147",
          overflow: "hidden",
        }}
      >
        <DungeonMap />
      </div>

      {/* Top-right: Agent Sidebar */}
      <div style={{ borderBottom: "1px solid #3f4147", overflow: "hidden" }}>
        <AgentSidebar />
      </div>

      {/* Bottom-left: Gantt Timeline */}
      <div style={{ borderRight: "1px solid #3f4147", overflow: "hidden" }}>
        <Timeline />
      </div>

      {/* Bottom-right: Live Feed */}
      <div style={{ overflow: "hidden" }}>
        <LiveFeed />
      </div>

      {/* Status Bar — spans both columns */}
      <div style={{ gridColumn: "1 / -1" }}>
        <StatusBar />
      </div>

      {/* Score Screen overlay (fixed, outside grid flow) */}
      <ScoreScreen />

      {/* Quest Log sidebar + Volume Controls (fixed overlay) */}
      <QuestLog />

      {/* Command Palette — appears when right-clicking rooms */}
      <CommandPalette />

      {/* World Map — shows all past sessions */}
      <WorldMap />
    </div>
    </CommandContext.Provider>
  );
}
