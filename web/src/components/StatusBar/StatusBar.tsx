import { useState } from "react";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";
import { soundManager } from "../../audio/SoundManager";

export function StatusBar() {
  const agents = useGameState((s) => s.agents);
  const connected = useGameState((s) => s.connected);
  const dag = useGameState((s) => s.dag);
  const transcript = useGameState((s) => s.eventRing.length);
  const clearEvents = useGameState((s) => s.clearEvents);
  const pruneEventsOlderThan = useGameState((s) => s.pruneEventsOlderThan);
  const reducedEffects = useGameState((s) => s.reducedEffects);
  const setReducedEffects = useGameState((s) => s.setReducedEffects);
  const [soundOn, setSoundOn] = useState(soundManager.isEnabled());
  const [pruneMinutes, setPruneMinutes] = useState("30");
  const [pruneFeedback, setPruneFeedback] = useState<string | null>(null);

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

  const handleClear = () => {
    if (!window.confirm("Clear all events from this session? Agents and tasks stay on the map.")) {
      return;
    }
    clearEvents();
    setPruneFeedback("cleared");
    setTimeout(() => setPruneFeedback(null), 2000);
  };

  const handlePrune = () => {
    const minutes = parseInt(pruneMinutes, 10);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setPruneFeedback("invalid");
      setTimeout(() => setPruneFeedback(null), 2000);
      return;
    }
    const removed = pruneEventsOlderThan(minutes);
    setPruneFeedback(`-${removed}`);
    setTimeout(() => setPruneFeedback(null), 2500);
  };

  const btnStyle = {
    background: "none",
    border: "1px solid #3f4147",
    borderRadius: 3,
    color: "#8b9aab",
    fontFamily: "monospace",
    fontSize: 11,
    cursor: "pointer",
    padding: "2px 6px",
  } as const;

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
      <span title="Events in ring buffer">Events: {transcript}</span>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {pruneFeedback && (
          <span style={{ color: pruneFeedback === "invalid" ? "#bf6b5b" : "#5baf7b", fontSize: 11 }}>
            {pruneFeedback === "cleared"
              ? "Events cleared"
              : pruneFeedback === "invalid"
                ? "Enter minutes > 0"
                : `Pruned ${pruneFeedback.slice(1)} items`}
          </span>
        )}

        <button
          onClick={handleClear}
          style={{ ...btnStyle, color: "#bf6b5b" }}
          title="Clear transcript, timeline, and event logs (keeps agents on map)"
        >
          CLEAR
        </button>

        <span style={{ color: "#3f4147" }}>|</span>

        <input
          type="number"
          min={1}
          value={pruneMinutes}
          onChange={(e) => setPruneMinutes(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handlePrune()}
          style={{
            width: 42,
            background: "#2b2d31",
            border: "1px solid #3f4147",
            borderRadius: 3,
            color: "#dbdee1",
            fontFamily: "monospace",
            fontSize: 11,
            padding: "2px 4px",
          }}
          title="Age threshold in minutes"
        />
        <span style={{ fontSize: 11 }}>min</span>
        <button
          onClick={handlePrune}
          style={btnStyle}
          title="Remove events older than the given minutes"
        >
          PRUNE
        </button>

        <span style={{ color: "#3f4147" }}>|</span>

        <button
          onClick={() => setReducedEffects(!reducedEffects)}
          style={{
            ...btnStyle,
            color: reducedEffects ? "#5baf7b" : "#8b9aab",
          }}
          title={reducedEffects ? "Lite mode on (fewer map effects)" : "Enable lite mode (disable ambient creatures)"}
        >
          {reducedEffects ? "LITE ON" : "LITE OFF"}
        </button>

        <button
          onClick={() => {
            soundManager.toggle();
            setSoundOn(soundManager.isEnabled());
          }}
          style={{
            ...btnStyle,
            color: soundOn ? "#5baf7b" : "#4e5058",
          }}
          title={soundOn ? "Mute sounds" : "Unmute sounds"}
        >
          {soundOn ? "SND ON" : "SND OFF"}
        </button>
      </div>
    </div>
  );
}
