import { useState, useEffect, useCallback } from "react";
import { useGameState } from "../../stores/gameState";
import { useCommand } from "../../App";

interface PaletteState {
  visible: boolean;
  x: number;
  y: number;
  agentId: string | null;
  agentName: string;
  nodeId: string | null;
}

const INITIAL: PaletteState = {
  visible: false,
  x: 0,
  y: 0,
  agentId: null,
  agentName: "",
  nodeId: null,
};

/**
 * CommandPalette — context menu for interacting with agents/rooms.
 *
 * Listens for a custom event "cli-dm:command-palette" dispatched from
 * DungeonMap.tsx when a room is right-clicked.
 */
export function CommandPalette() {
  const [state, setState] = useState<PaletteState>(INITIAL);
  const sendCommand = useCommand();
  const agents = useGameState((s) => s.agents);
  const selectAgent = useGameState((s) => s.selectAgent);

  // Listen for palette open events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        x: number;
        y: number;
        agentId: string;
        agentName: string;
        nodeId: string;
      };
      setState({
        visible: true,
        x: detail.x,
        y: detail.y,
        agentId: detail.agentId,
        agentName: detail.agentName,
        nodeId: detail.nodeId,
      });
    };
    window.addEventListener("cli-dm:command-palette", handler);
    return () => window.removeEventListener("cli-dm:command-palette", handler);
  }, []);

  // Close on click outside or Escape
  useEffect(() => {
    if (!state.visible) return;
    const closeOnClick = () => setState(INITIAL);
    const closeOnEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setState(INITIAL);
    };
    // Delay to prevent immediate close from the triggering click
    const timer = setTimeout(() => {
      window.addEventListener("click", closeOnClick);
      window.addEventListener("keydown", closeOnEsc);
    }, 50);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("click", closeOnClick);
      window.removeEventListener("keydown", closeOnEsc);
    };
  }, [state.visible]);

  const handleKill = useCallback(() => {
    if (state.agentId) {
      sendCommand("cmd.agent.kill", { agentId: state.agentId });
    }
    setState(INITIAL);
  }, [state.agentId, sendCommand]);

  const handleSelect = useCallback(() => {
    if (state.agentId) {
      selectAgent(state.agentId);
    }
    setState(INITIAL);
  }, [state.agentId, selectAgent]);

  const handleInterrupt = useCallback(() => {
    if (state.agentId) {
      sendCommand("cmd.agent.signal", { agentId: state.agentId, signal: "interrupt" });
    }
    setState(INITIAL);
  }, [state.agentId, sendCommand]);

  if (!state.visible) return null;

  const agent = state.agentId ? agents.get(state.agentId) : null;
  const isComplete = agent?.isComplete ?? false;
  const isBlocked = agent?.isBlocked ?? false;

  // Position — keep on screen
  const left = Math.min(state.x, window.innerWidth - 200);
  const top = Math.min(state.y, window.innerHeight - 250);

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 9999,
        background: "#1e1f22",
        border: "1px solid #5b8abf",
        borderRadius: 6,
        padding: 0,
        minWidth: 180,
        boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
        fontFamily: "'Courier New', monospace",
        fontSize: 12,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #3f4147",
          color: "#5b8abf",
          fontWeight: "bold",
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1,
        }}
      >
        {state.agentName || "Room"}
      </div>

      {/* Commands */}
      <div style={{ padding: "4px 0" }}>
        <PaletteItem
          label="Inspect Agent"
          shortcut="I"
          onClick={handleSelect}
          disabled={!state.agentId}
        />
        <PaletteItem
          label="Interrupt"
          shortcut="Ctrl+C"
          onClick={handleInterrupt}
          disabled={!state.agentId || isComplete}
          danger
        />
        <PaletteItem
          label="Kill Agent"
          shortcut="K"
          onClick={handleKill}
          disabled={!state.agentId || isComplete}
          danger
        />

        <div style={{ height: 1, background: "#3f4147", margin: "4px 0" }} />

        {/* Status indicators */}
        {agent && (
          <div style={{ padding: "4px 12px", color: "#8b9aab", fontSize: 11 }}>
            <div>Action: {agent.currentAction}</div>
            <div>Level: {agent.level} | XP: {agent.xp}</div>
            {isBlocked && <div style={{ color: "#bfa85b" }}>BLOCKED</div>}
            {isComplete && <div style={{ color: "#5baf7b" }}>COMPLETED</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function PaletteItem({
  label,
  shortcut,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "6px 12px",
        border: "none",
        background: hovered && !disabled ? "#2b2d31" : "transparent",
        color: disabled
          ? "#4e5058"
          : danger
            ? "#bf6b5b"
            : "#dbdee1",
        cursor: disabled ? "default" : "pointer",
        fontFamily: "inherit",
        fontSize: 12,
        textAlign: "left",
      }}
    >
      <span>{label}</span>
      {shortcut && (
        <span style={{ color: "#4e5058", fontSize: 10, marginLeft: 12 }}>
          {shortcut}
        </span>
      )}
    </button>
  );
}
