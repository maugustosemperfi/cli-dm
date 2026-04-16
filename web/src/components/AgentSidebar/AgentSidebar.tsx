import { useEffect, useRef } from "react";
import { useGameState, xpForNextLevel, AGENT_COLORS } from "../../stores/gameState";
import type { AgentState } from "../../stores/gameState";
import type { DAGSnapshot, NodeStatus } from "../../protocol/events";
import { BossHPBar } from "./BossHPBar";
import { FileHeatmap } from "./FileHeatmap";

// ── Sparkline ────────────────────────────────────────────────────────────────

const SPARKLINE_SAMPLES = 30;
const SPARKLINE_INTERVAL_MS = 2000;
const SPARKLINE_HEIGHT = 20;

interface SparklineProps {
  agentId: string;
  color: string;
  samplesRef: React.MutableRefObject<Map<string, number[]>>;
}

function Sparkline({ agentId, color, samplesRef }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Keep canvas pixel dimensions in sync with its CSS-rendered size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (canvas.width !== Math.round(width)) {
          canvas.width = Math.round(width);
        }
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let raf: number;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const samples = samplesRef.current.get(agentId) ?? [];

      ctx.clearRect(0, 0, w, h);

      if (samples.length < 2) {
        raf = requestAnimationFrame(draw);
        return;
      }

      const step = w / (SPARKLINE_SAMPLES - 1);

      // Build path
      ctx.beginPath();
      for (let i = 0; i < samples.length; i++) {
        const x = i * step;
        const y = h - samples[i] * (h - 2) - 1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      // Stroke line
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();

      // Fill area under line with 10% alpha
      ctx.lineTo((samples.length - 1) * step, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = color + "1a";
      ctx.fill();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [agentId, color, samplesRef]);

  return (
    <canvas
      ref={canvasRef}
      height={SPARKLINE_HEIGHT}
      style={{
        width: "100%",
        height: SPARKLINE_HEIGHT,
        display: "block",
        borderRadius: 2,
      }}
    />
  );
}

// ── Building System ─────────────────────────────────────────────────────────

const BUILDING_NAMES: Record<string, string[]> = {
  warrior: ["Guard Post", "Barracks", "Fortress", "Citadel"],
  rogue:   ["Hideout", "Tavern", "Den", "Guild"],
  mage:    ["Study", "Tower", "Spire", "Sanctum"],
  ranger:  ["Shelter", "Lodge", "Outpost", "Keep"],
  cleric:  ["Shrine", "Chapel", "Temple", "Cathedral"],
  bard:    ["Campfire", "Stage", "Theater", "Grand Theater"],
  cavern:  ["Crack", "Cavern", "Deep Cavern", "Crystal Cave"],
};

function getBuildingTier(level: number): number {
  if (level >= 8) return 4;
  if (level >= 5) return 3;
  if (level >= 3) return 2;
  return 1;
}

function getBuilding(role: string, level: number) {
  const tier = getBuildingTier(level);
  const family = role in BUILDING_NAMES ? role : "cavern";
  return {
    name: BUILDING_NAMES[family][tier - 1],
    roofClass: `roof-${family}-${tier}`,
    tier,
    family,
  };
}

// ── Agent Card ───────────────────────────────────────────────────────────────

const STATUS_DOT_COLORS: Record<NodeStatus, string> = {
  pending: "#4e5058",
  in_progress: "#5b8abf",
  completed: "#5baf7b",
  failed: "#bf6b5b",
  blocked: "#bfa85b",
};

interface AgentCardProps {
  agent: AgentState;
  isSelected: boolean;
  onSelect: () => void;
  samplesRef: React.MutableRefObject<Map<string, number[]>>;
  dag: DAGSnapshot;
}

function AgentCard({ agent, isSelected, onSelect, samplesRef, dag }: AgentCardProps) {
  const color = AGENT_COLORS[agent.role] ?? "#8b9aab";
  const xpNeeded = xpForNextLevel(agent.level);
  const xpProgress = xpNeeded > 0 ? Math.min(1, agent.xp / xpNeeded) : 1;
  const goldDisplay = agent.gold > 0 ? (agent.gold / 100).toFixed(3) : "0.000";
  const tokensDisplay =
    agent.tokens > 1000
      ? `${(agent.tokens / 1000).toFixed(1)}k`
      : String(agent.tokens);

  const building = getBuilding(agent.role, agent.level);
  const dagNode = dag.nodes.find((n) => n.assignee === agent.agentId);

  // Build CSS class list
  const activityClass = agent.isComplete ? "" : `activity-${agent.currentAction}`;
  const classes = [
    "building",
    `tier-${building.tier}`,
    activityClass,
    agent.isComplete ? "building-complete" : "",
    isSelected ? "building-selected" : "",
  ].filter(Boolean).join(" ");

  const cssVars = { "--b-color": color } as React.CSSProperties;

  if (agent.isComplete) {
    return (
      <div className={classes} onClick={onSelect} style={cssVars}>
        <div className={`building-roof ${building.roofClass}`} />
        <div className="building-type-label">ruins</div>
        <div className="building-interior" style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 8px 4px" }}>
          <span style={{ ...styles.levelBadge, borderColor: color }}>
            Lv.{agent.level}
          </span>
          <span style={{ ...styles.agentName, color, flex: 1 }}>{agent.name}</span>
          <span style={styles.actionLabel}>done</span>
        </div>
      </div>
    );
  }

  return (
    <div className={classes} onClick={onSelect} style={cssVars}>
      {/* Roof */}
      <div className={`building-roof ${building.roofClass}`} />

      {/* Building type label */}
      <div className="building-type-label">{building.name}</div>

      {/* Interior */}
      <div className="building-interior">
        {/* Header row */}
        <div style={styles.headerRow}>
          <span style={{ ...styles.levelBadge, borderColor: color }}>
            Lv.{agent.level}
          </span>
          <span style={{ ...styles.agentName, color }}>{agent.name}</span>
          <span style={styles.actionLabel}>
            {agent.currentAction !== "idle" ? agent.currentAction : "idle"}
          </span>
        </div>

        {/* Task row */}
        {dagNode && (
          <div style={styles.taskRow}>
            <span
              style={{
                ...styles.taskDot,
                backgroundColor: STATUS_DOT_COLORS[dagNode.status],
              }}
            />
            <span style={styles.taskLabel}>{dagNode.label}</span>
          </div>
        )}

        {/* XP bar */}
        <div style={styles.barRow}>
          <span style={styles.barLabel}>XP</span>
          <div style={styles.barBg}>
            <div
              style={{
                ...styles.barFill,
                width: `${xpProgress * 100}%`,
                backgroundColor: color,
              }}
            />
          </div>
          <span style={styles.barValue}>{agent.xp}</span>
        </div>

        {/* Stats row */}
        <div style={styles.statsRow}>
          <span style={styles.stat}>
            <span style={styles.goldIcon}>$</span>
            {goldDisplay}
          </span>
          <span style={styles.stat}>
            <span style={styles.tokenIcon}>T</span>
            {tokensDisplay}
          </span>
        </div>

        {/* Sparkline */}
        <div style={styles.sparklineWrap}>
          <Sparkline agentId={agent.agentId} color={color} samplesRef={samplesRef} />
        </div>
      </div>
    </div>
  );
}

// ── AgentSidebar ─────────────────────────────────────────────────────────────

export function AgentSidebar() {
  const agents = useGameState((s) => s.agents);
  const selectedAgent = useGameState((s) => s.selectedAgent);
  const selectAgent = useGameState((s) => s.selectAgent);
  const dag = useGameState((s) => s.dag);

  // Rolling sparkline sample storage, keyed by agentId
  const samplesRef = useRef<Map<string, number[]>>(new Map());

  // Sample activity for sparklines every 2s
  useEffect(() => {
    const interval = setInterval(() => {
      for (const [id, agent] of agents) {
        if (!samplesRef.current.has(id)) samplesRef.current.set(id, []);
        const arr = samplesRef.current.get(id)!;
        const isActive = agent.currentAction !== "idle" && !agent.isComplete;
        arr.push(isActive ? 1 : 0);
        if (arr.length > SPARKLINE_SAMPLES) arr.shift();
      }
    }, SPARKLINE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [agents]);

  const agentList = [...agents.values()].sort((a, b) => {
    // Active agents first, then by XP descending
    if (a.isComplete !== b.isComplete) return a.isComplete ? 1 : -1;
    return b.xp - a.xp;
  });

  return (
    <div style={styles.sidebar}>
      {/* Agent cards */}
      <div style={styles.cardList}>
        {agentList.length === 0 ? (
          <div style={styles.emptyState}>no agents connected</div>
        ) : (
          agentList.map((agent) => (
            <AgentCard
              key={agent.agentId}
              agent={agent}
              isSelected={selectedAgent === agent.agentId}
              onSelect={() =>
                selectAgent(
                  selectedAgent === agent.agentId ? null : agent.agentId
                )
              }
              samplesRef={samplesRef}
              dag={dag}
            />
          ))
        )}
      </div>

      {/* Divider */}
      <div style={styles.divider} />

      {/* Boss HP Bar */}
      <BossHPBar />

      {/* Divider */}
      <div style={styles.divider} />

      {/* File Heatmap */}
      <FileHeatmap />
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  sidebar: {
    height: "100%",
    overflowY: "auto",
    background: "#1e1f22",
    display: "flex",
    flexDirection: "column",
    fontFamily: "monospace",
    scrollbarWidth: "thin",
    scrollbarColor: "#3f4147 #1e1f22",
  },
  cardList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "6px 6px 0",
    flex: "0 0 auto",
  },
  // card styling now handled by CSS .building class
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 5,
  },
  levelBadge: {
    border: "1px solid",
    borderRadius: 3,
    padding: "0 4px",
    fontSize: 9,
    color: "#dbdee1",
    fontWeight: "bold",
    flexShrink: 0,
  },
  agentName: {
    fontSize: 11,
    fontWeight: "bold",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actionLabel: {
    fontSize: 9,
    color: "#6d6f78",
    textAlign: "right",
    flexShrink: 0,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  taskRow: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    marginBottom: 5,
  },
  taskDot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flexShrink: 0,
  },
  taskLabel: {
    fontSize: 10,
    color: "#8b9aab",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  barRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginBottom: 3,
  },
  barLabel: {
    color: "#8b9aab",
    fontSize: 9,
    width: 14,
    flexShrink: 0,
  },
  barBg: {
    flex: 1,
    height: 4,
    background: "#1e1f22",
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
  barValue: {
    color: "#8b9aab",
    fontSize: 9,
    width: 30,
    textAlign: "right",
    flexShrink: 0,
  },
  statsRow: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  stat: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    fontSize: 10,
    color: "#8b9aab",
  },
  goldIcon: {
    color: "#bfa85b",
    fontWeight: "bold",
    fontSize: 10,
  },
  tokenIcon: {
    color: "#5b8abf",
    fontWeight: "bold",
    fontSize: 10,
  },
  sparklineWrap: {
    width: "100%",
    height: SPARKLINE_HEIGHT,
    overflow: "hidden",
    borderRadius: 2,
    background: "#1e1f22",
  },
  divider: {
    height: 1,
    background: "#3f4147",
    margin: "6px 0",
    flexShrink: 0,
  },
  emptyState: {
    color: "#6d6f78",
    fontSize: 10,
    padding: "12px 4px",
    textAlign: "center",
    letterSpacing: "0.5px",
  },
};
