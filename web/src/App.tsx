import { useWebSocket } from "./hooks/useWebSocket";
import { DungeonMap } from "./components/DungeonMap/DungeonMap";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { Timeline } from "./components/Timeline/Timeline";
import { AgentSidebar } from "./components/AgentSidebar/AgentSidebar";
import { LiveFeed } from "./components/LiveFeed/LiveFeed";
import { ScoreScreen } from "./components/ScoreScreen/ScoreScreen";
import { QuestLog } from "./components/QuestLog/QuestLog";

const WS_URL =
  import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}/api/ws`;

export function App() {
  useWebSocket({ url: WS_URL });

  return (
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
    </div>
  );
}
