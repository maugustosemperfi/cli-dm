import { useGameState, AGENT_COLORS } from "../../stores/gameState";

export function FileHeatmap() {
  const agents = useGameState((s) => s.agents);

  // Aggregate directories across all agents
  const dirCounts = new Map<string, { count: number; color: string }>();
  for (const agent of agents.values()) {
    const color = AGENT_COLORS[agent.role] ?? "#8b9aab";
    for (const path of agent.discoveredPaths) {
      // Take first 2 segments: "src/components" from "src/components/DungeonMap/foo.ts"
      const segments = path.split("/").filter(Boolean);
      const topDir = segments.slice(0, 2).join("/");
      if (!topDir) continue;
      const entry = dirCounts.get(topDir) ?? { count: 0, color };
      entry.count++;
      dirCounts.set(topDir, entry);
    }
  }

  // Sort by count descending, limit to 8
  const sorted = [...dirCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8);

  const maxCount = sorted.length > 0 ? sorted[0][1].count : 1;

  if (sorted.length === 0) return null;

  const totalPaths = [...agents.values()].reduce(
    (sum, agent) => sum + agent.discoveredPaths.size,
    0
  );

  return (
    <div style={styles.container}>
      {/* Section header */}
      <div style={styles.header}>
        <span style={styles.headerLabel}>EXPLORED</span>
        <span style={styles.headerCount}>{totalPaths}</span>
      </div>

      {/* Directory rows */}
      <div style={styles.rows}>
        {sorted.map(([dir, { count, color }]) => {
          const barWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;
          return (
            <div key={dir} style={styles.row}>
              <div style={styles.dirName} title={dir}>
                {dir}
              </div>
              <div style={styles.barTrack}>
                <div
                  style={{
                    ...styles.barFill,
                    width: `${barWidth}%`,
                    backgroundColor: color,
                  }}
                />
              </div>
              <div style={styles.countLabel}>{count}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    borderTop: "1px solid #3f4147",
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 8,
    paddingRight: 8,
    fontFamily: "monospace",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  headerLabel: {
    fontSize: 9,
    fontWeight: "bold",
    color: "#6d6f78",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  },
  headerCount: {
    fontSize: 9,
    color: "#6d6f78",
  },
  rows: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    height: 18,
  },
  dirName: {
    fontSize: 10,
    color: "#dbdee1",
    width: 90,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  },
  barTrack: {
    flex: 1,
    height: 6,
    background: "#1e1f22",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
    transition: "width 0.3s ease",
  },
  countLabel: {
    fontSize: 9,
    color: "#6d6f78",
    textAlign: "right" as const,
    width: 20,
    flexShrink: 0,
  },
};
