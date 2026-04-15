import { useGameState, xpForNextLevel, AGENT_COLORS } from "../../stores/gameState";

export function StatsHUD() {
  const agents = useGameState((s) => s.agents);
  const selectedAgent = useGameState((s) => s.selectedAgent);

  // Show stats for selected agent, or top 3 by XP
  const agentList = selectedAgent
    ? [agents.get(selectedAgent)].filter(Boolean)
    : [...agents.values()]
        .filter((a) => !a.isComplete)
        .sort((a, b) => b.xp - a.xp)
        .slice(0, 4);

  if (agentList.length === 0) return null;

  return (
    <div style={styles.container}>
      {agentList.map((agent) => {
        if (!agent) return null;
        const xpNeeded = xpForNextLevel(agent.level);
        const xpProgress = xpNeeded > 0 ? Math.min(1, agent.xp / xpNeeded) : 1;
        const color = AGENT_COLORS[agent.role] ?? "#8b9aab";
        const goldDisplay = agent.gold > 0 ? (agent.gold / 100).toFixed(3) : "0";

        return (
          <div key={agent.agentId} style={styles.agentCard}>
            <div style={styles.header}>
              <span style={{ ...styles.levelBadge, borderColor: color }}>
                Lv.{agent.level}
              </span>
              <span style={{ ...styles.name, color }}>{agent.name}</span>
            </div>

            {/* XP Bar */}
            <div style={styles.barContainer}>
              <div style={styles.barLabel}>XP</div>
              <div style={styles.barBg}>
                <div
                  style={{
                    ...styles.barFill,
                    width: `${xpProgress * 100}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              <div style={styles.barValue}>{agent.xp}</div>
            </div>

            {/* Gold + Tokens */}
            <div style={styles.statsRow}>
              <span style={styles.stat}>
                <span style={styles.goldIcon}>G</span> ${goldDisplay}
              </span>
              <span style={styles.stat}>
                <span style={styles.tokenIcon}>T</span>{" "}
                {agent.tokens > 1000
                  ? `${(agent.tokens / 1000).toFixed(1)}k`
                  : agent.tokens}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: "absolute",
    top: 8,
    right: 8,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    pointerEvents: "none",
    zIndex: 10,
  },
  agentCard: {
    background: "rgba(43, 45, 49, 0.92)",
    border: "1px solid #3f4147",
    borderRadius: 4,
    padding: "6px 10px",
    minWidth: 160,
    fontFamily: "monospace",
    fontSize: 11,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginBottom: 4,
  },
  levelBadge: {
    border: "1px solid",
    borderRadius: 3,
    padding: "0 4px",
    fontSize: 10,
    color: "#dbdee1",
    fontWeight: "bold",
  },
  name: {
    fontSize: 11,
    fontWeight: "bold",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  barContainer: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginBottom: 2,
  },
  barLabel: {
    color: "#8b9aab",
    fontSize: 9,
    width: 16,
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
    textAlign: "right" as const,
  },
  statsRow: {
    display: "flex",
    justifyContent: "space-between",
    color: "#8b9aab",
    fontSize: 10,
  },
  stat: {
    display: "flex",
    alignItems: "center",
    gap: 3,
  },
  goldIcon: {
    color: "#bfa85b",
    fontWeight: "bold",
  },
  tokenIcon: {
    color: "#5b8abf",
    fontWeight: "bold",
  },
};
