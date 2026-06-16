import { useState, useMemo } from "react";
import { useGameState, AGENT_COLORS, xpForNextLevel } from "../../stores/gameState";
import { deriveTimeline } from "../../stores/deriveViews";

// ─── Format helpers ────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

function formatGold(cents: number): string {
  return `$${(cents / 100).toFixed(3)}`;
}

function formatTokens(t: number): string {
  return t > 1000 ? `${(t / 1000).toFixed(1)}k` : `${t}`;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ScoreScreen() {
  const agents = useGameState((s) => s.agents);
  const eventRing = useGameState((s) => s.eventRing);
  const eventRingVersion = useGameState((s) => s.eventRingVersion);
  const timeline = useMemo(
    () => deriveTimeline(eventRing, agents),
    [eventRing, eventRingVersion, agents]
  );
  const [dismissed, setDismissed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Find root agent (warrior or first agent)
  const rootAgent =
    [...agents.values()].find((a) => a.role === "warrior") ??
    [...agents.values()][0];

  // Show only when root agent is complete and not dismissed
  if (!rootAgent?.isComplete || dismissed) return null;

  // Non-idle agents to display
  const activeAgents = [...agents.values()].filter(
    (a) => a.xp > 0 || a.gold > 0 || a.tokens > 0
  );

  // Session duration
  const sessionStart = timeline.length > 0 ? timeline[0].startTs : 0;
  const sessionEnd =
    timeline.length > 0
      ? Math.max(...timeline.map((s) => s.endTs ?? Date.now()))
      : Date.now();
  const durationMs = sessionEnd - sessionStart;

  // Totals
  const totalGold = activeAgents.reduce((sum, a) => sum + a.gold, 0);
  const totalTokens = activeAgents.reduce((sum, a) => sum + a.tokens, 0);
  const totalFiles = activeAgents.reduce((sum, a) => sum + a.discoveredPathCount, 0);

  // Copy stats as markdown table
  function handleCopyStats() {
    const header = "| Agent | Role | Level | XP | Gold | Tokens | Files | Edits | Builds | Tests |";
    const divider = "|-------|------|-------|----|------|--------|-------|-------|--------|-------|";
    const rows = activeAgents.map((a) =>
      `| ${a.name} | ${a.role} | ${a.level} | ${a.xp} | ${formatGold(a.gold)} | ${formatTokens(a.tokens)} | ${a.discoveredPathCount} | ${a.totalEdits} | ${a.totalBuilds} | ${a.totalTests} |`
    );
    const totalsRow = `| **TOTAL** | — | — | — | ${formatGold(totalGold)} | ${formatTokens(totalTokens)} | ${totalFiles} | — | — | — |`;
    const table = [header, divider, ...rows, totalsRow].join("\n");
    const text = `## Quest Complete\nDuration: ${formatDuration(durationMs)}\n\n${table}`;

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div style={styles.backdrop}>
      <div style={styles.card}>
        {/* Title */}
        <div style={styles.title}>QUEST COMPLETE</div>
        <div style={styles.duration}>Duration: {formatDuration(durationMs)}</div>

        <div style={styles.separator} />

        {/* Per-agent rows */}
        {activeAgents.map((agent) => {
          const color = AGENT_COLORS[agent.role] ?? "#8b9aab";
          const xpNeeded = xpForNextLevel(agent.level);
          return (
            <div key={agent.agentId} style={styles.agentRow}>
              {/* Agent header */}
              <div style={styles.agentHeader}>
                <span style={{ ...styles.agentName, color }}>{agent.name}</span>
                <span style={{ ...styles.levelBadge, borderColor: color }}>
                  Lv.{agent.level}
                </span>
                <span style={styles.xpNeeded}>→ {xpNeeded} XP to next</span>
              </div>

              {/* Stats grid */}
              <div style={styles.statsGrid}>
                <StatCell label="XP" value={String(agent.xp)} />
                <StatCell label="Gold" value={formatGold(agent.gold)} />
                <StatCell label="Tokens" value={formatTokens(agent.tokens)} />
                <StatCell label="Files" value={String(agent.discoveredPathCount)} />
                <StatCell label="Edits" value={String(agent.totalEdits)} />
                <StatCell label="Builds" value={String(agent.totalBuilds)} />
                <StatCell label="Tests" value={String(agent.totalTests)} />
              </div>
            </div>
          );
        })}

        <div style={styles.separator} />

        {/* Totals row */}
        <div style={styles.totalsRow}>
          <TotalCell label="Total Cost" value={formatGold(totalGold)} />
          <TotalCell label="Total Tokens" value={formatTokens(totalTokens)} />
          <TotalCell label="Files Explored" value={String(totalFiles)} />
        </div>

        <div style={styles.separator} />

        {/* Buttons */}
        <div style={styles.buttonsRow}>
          <CopyButton onClick={handleCopyStats} copied={copied} />
          <button className="score-btn" style={styles.button} onClick={() => setDismissed(true)}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.statCell}>
      <span style={styles.statLabel}>{label}</span>
      <span style={styles.statValue}>{value}</span>
    </div>
  );
}

function TotalCell({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.totalCell}>
      <span style={styles.totalLabel}>{label}</span>
      <span style={styles.totalValue}>{value}</span>
    </div>
  );
}

function CopyButton({ onClick, copied }: { onClick: () => void; copied: boolean }) {
  return (
    <button className="score-btn" style={styles.button} onClick={onClick}>
      {copied ? "Copied!" : "Copy Stats"}
    </button>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 100,
    background: "rgba(0, 0, 0, 0.85)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    maxWidth: 600,
    width: "100%",
    background: "#2b2d31",
    border: "1px solid #3f4147",
    borderRadius: 8,
    padding: 24,
    fontFamily: "monospace",
    animation: "scoreCardEnter 0.5s ease forwards",
  },
  title: {
    textAlign: "center" as const,
    fontSize: 18,
    fontWeight: "bold",
    color: "#dbdee1",
    letterSpacing: 2,
    marginBottom: 6,
  },
  duration: {
    textAlign: "center" as const,
    fontSize: 12,
    color: "#8b9aab",
    marginBottom: 0,
  },
  separator: {
    height: 1,
    background: "#3f4147",
    margin: "12px 0",
  },
  agentRow: {
    marginBottom: 12,
  },
  agentHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBottom: 6,
  },
  agentName: {
    fontWeight: "bold",
    fontSize: 13,
  },
  levelBadge: {
    border: "1px solid",
    borderRadius: 3,
    padding: "0 5px",
    fontSize: 10,
    color: "#dbdee1",
    fontWeight: "bold",
  },
  xpNeeded: {
    fontSize: 10,
    color: "#6d6f78",
    marginLeft: "auto",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "4px 8px",
  },
  statCell: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 1,
  },
  statLabel: {
    fontSize: 9,
    color: "#6d6f78",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  statValue: {
    fontSize: 12,
    color: "#dbdee1",
  },
  totalsRow: {
    display: "flex",
    justifyContent: "space-around",
    gap: 8,
  },
  totalCell: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center" as const,
    gap: 2,
  },
  totalLabel: {
    fontSize: 10,
    color: "#8b9aab",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  totalValue: {
    fontSize: 14,
    color: "#dbdee1",
    fontWeight: "bold",
  },
  buttonsRow: {
    display: "flex",
    gap: 8,
    justifyContent: "center",
  },
  button: {
    background: "#3f4147",
    border: "none",
    color: "#dbdee1",
    padding: "8px 16px",
    borderRadius: 4,
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: 12,
  },
};
