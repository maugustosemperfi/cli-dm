import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";

interface TerminalPaneProps {
  terminalRefs: React.MutableRefObject<Map<string, Terminal>>;
}

export function TerminalPane({ terminalRefs }: TerminalPaneProps) {
  const agents = useGameState((s) => s.agents);
  const selectedAgent = useGameState((s) => s.selectedAgent);
  const selectAgent = useGameState((s) => s.selectAgent);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        gap: 3,
        overflow: "auto",
      }}
    >
      {Array.from(agents.values()).map((agent) => (
        <AgentTerminal
          key={agent.agentId}
          agentId={agent.agentId}
          name={agent.name}
          role={agent.role}
          currentAction={agent.currentAction}
          currentDetail={agent.currentDetail}
          isComplete={agent.isComplete ?? false}
          isSelected={selectedAgent === agent.agentId}
          onSelect={() => selectAgent(agent.agentId)}
          terminalRefs={terminalRefs}
        />
      ))}
      {agents.size === 0 && (
        <div
          style={{
            color: "#6d6f78",
            padding: 20,
            textAlign: "center",
            fontFamily: "monospace",
          }}
        >
          Waiting for agents to spawn...
        </div>
      )}
    </div>
  );
}

interface AgentTerminalProps {
  agentId: string;
  name: string;
  role: string;
  currentAction: string;
  currentDetail?: string;
  isComplete: boolean;
  isSelected: boolean;
  onSelect: () => void;
  terminalRefs: React.MutableRefObject<Map<string, Terminal>>;
}

function AgentTerminal({
  agentId,
  name,
  role,
  currentAction,
  currentDetail,
  isComplete,
  isSelected,
  onSelect,
  terminalRefs,
}: AgentTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const color = AGENT_COLORS[role] ?? "#8b9aab";

  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#1e1f22",
        foreground: "#dbdee1",
        cursor: color,
        selectionBackground: "#3f4147",
      },
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      scrollback: 5000,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    terminalRefs.current.set(agentId, term);

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore fit errors during unmount
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      terminalRefs.current.delete(agentId);
      term.dispose();
      termRef.current = null;
    };
  }, [agentId, color, terminalRefs]);

  const actionIcon = ACTION_ICONS[currentAction] ?? "?";
  const statusText = isComplete
    ? "DONE"
    : currentAction === "idle"
      ? "~ IDLE — waiting for activity"
      : `${actionIcon} ${currentAction}${currentDetail ? `: ${currentDetail}` : ""}`;

  return (
    <div
      onClick={onSelect}
      style={{
        flex: 1,
        minHeight: 150,
        display: "flex",
        flexDirection: "column",
        border: isSelected ? `1px solid ${color}` : "1px solid #3f4147",
        borderRadius: 4,
        overflow: "hidden",
        opacity: isComplete ? 0.7 : 1,
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "4px 8px",
          background: "#2b2d31",
          borderBottom: `2px solid ${color}`,
          fontSize: 12,
          fontFamily: "monospace",
          color: "#dbdee1",
          cursor: "pointer",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: isComplete ? "#6d6f78" : color,
            display: "inline-block",
          }}
        />
        <span style={{ color, fontWeight: "bold" }}>
          [{agentId.toUpperCase()}] {name}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 11,
            color: currentAction === "error" ? "#bf6b5b" : "#8b9aab",
          }}
        >
          {statusText}
        </span>
      </div>

      {/* Terminal */}
      <div ref={containerRef} style={{ flex: 1, padding: 2 }} />
    </div>
  );
}

const ACTION_ICONS: Record<string, string> = {
  idle: "~",
  thinking: "*",
  read: "R",
  edit: "E",
  test: "!",
  git: "G",
  build: "B",
  shell: "$",
  network: "N",
  blocked: "X",
  error: "!",
};
