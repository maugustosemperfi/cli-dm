import { useState } from "react";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";
import { soundManager } from "../../audio/SoundManager";

export function StatusBar() {
  const agents = useGameState((s) => s.agents);
  const connected = useGameState((s) => s.connected);
  const dag = useGameState((s) => s.dag);
  const [soundOn, setSoundOn] = useState(soundManager.isEnabled());

  const agentList = Array.from(agents.values());
  const active = agentList.filter(
    (a) => !a.isComplete && a.currentAction !== "idle"
  ).length;
  const completed = agentList.filter((a) => a.isComplete).length;
  const blocked = agentList.filter((a) => a.isBlocked).length;
  const total = agentList.length;
  const efficiency =
    total > 0 ? Math.round((active / Math.max(total - completed, 1)) * 100) : 0;

  const tasksCompleted = dag.nodes.filter((n) => n.status === "completed").length;
  const tasksTotal = dag.nodes.length;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "6px 12px",
        background: "#1e1f22",
        borderTop: "1px solid #3f4147",
        fontFamily: "monospace",
        fontSize: 12,
        color: "#8b9aab",
      }}
    >
      {/* Connection status */}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: connected ? "#5baf7b" : "#bf6b5b",
          display: "inline-block",
        }}
      />
      <span>{connected ? "CONNECTED" : "DISCONNECTED"}</span>

      <span style={{ color: "#3f4147" }}>|</span>

      {/* Agent summary dots */}
      <span>Agents:</span>
      {agentList.map((a) => (
        <span
          key={a.agentId}
          title={`${a.name}: ${a.currentAction}`}
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            background: a.isComplete
              ? "#4e5058"
              : a.isBlocked
                ? "#bf6b5b"
                : AGENT_COLORS[a.role] ?? "#8b9aab",
            display: "inline-block",
            opacity: a.currentAction === "idle" ? 0.4 : 1,
          }}
        />
      ))}

      <span style={{ color: "#3f4147" }}>|</span>

      <span>
        Active: {active}/{total - completed}
      </span>
      <span>Blocked: {blocked}</span>
      <span>Done: {completed}</span>

      <span style={{ color: "#3f4147" }}>|</span>

      <span>
        Tasks: {tasksCompleted}/{tasksTotal}
      </span>
      <span>Parallelization: {efficiency}%</span>

      <span style={{ color: "#3f4147" }}>|</span>

      {/* Sound toggle */}
      <button
        onClick={() => {
          soundManager.toggle();
          setSoundOn(soundManager.isEnabled());
        }}
        style={{
          background: "none",
          border: "1px solid #3f4147",
          borderRadius: 3,
          color: soundOn ? "#5baf7b" : "#4e5058",
          fontFamily: "monospace",
          fontSize: 11,
          cursor: "pointer",
          padding: "2px 6px",
        }}
        title={soundOn ? "Mute sounds" : "Unmute sounds"}
      >
        {soundOn ? "SND ON" : "SND OFF"}
      </button>
    </div>
  );
}
