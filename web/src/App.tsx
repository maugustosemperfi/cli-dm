import { useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { useWebSocket } from "./hooks/useWebSocket";
import { TerminalPane } from "./components/TerminalPane/TerminalPane";
import { DungeonMap } from "./components/DungeonMap/DungeonMap";
import { StatusBar } from "./components/StatusBar/StatusBar";
import { DAGPanel } from "./components/DAGPanel/DAGPanel";
import { EventLog } from "./components/EventLog/EventLog";

const WS_URL =
  import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}/api/ws`;

type RightTab = "terminals" | "tasks" | "log";

export function App() {
  const terminalRefs = useRef<Map<string, Terminal>>(new Map());
  const [activeTab, setActiveTab] = useState<RightTab>("terminals");

  const handleRawOutput = useCallback(
    (agentId: string, data: Uint8Array) => {
      const term = terminalRefs.current.get(agentId);
      if (term) {
        term.write(data);
      }
    },
    []
  );

  useWebSocket({ url: WS_URL, onRawOutput: handleRawOutput });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#2b2d31",
        color: "#dbdee1",
      }}
    >
      {/* Main content: Map (60%) + Right Panel (40%) */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Dungeon Map */}
        <div style={{ width: "60%", borderRight: "1px solid #3f4147" }}>
          <DungeonMap />
        </div>

        {/* Right Panel with tabs */}
        <div
          style={{
            width: "40%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Tab bar */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #3f4147",
              background: "#1e1f22",
            }}
          >
            {(["terminals", "tasks", "log"] as RightTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: "6px 12px",
                  fontFamily: "monospace",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  background: "none",
                  border: "none",
                  borderBottom:
                    activeTab === tab
                      ? "2px solid #5b8abf"
                      : "2px solid transparent",
                  color: activeTab === tab ? "#dbdee1" : "#6d6f78",
                  cursor: "pointer",
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: "hidden", padding: activeTab === "terminals" ? 4 : 0 }}>
            {activeTab === "terminals" && (
              <TerminalPane terminalRefs={terminalRefs} />
            )}
            {activeTab === "tasks" && <DAGPanel />}
            {activeTab === "log" && <EventLog />}
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}
