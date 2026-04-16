import { useEffect, useRef, useState } from "react";
import { useGameState } from "../../stores/gameState";

function getThreatColor(threatLevel: number): string {
  if (threatLevel < 0.33) return "#5baf7b";
  if (threatLevel < 0.66) return "#bfa85b";
  return "#bf6b5b";
}

function getBossColor(type: string): string {
  switch (type) {
    case 'test_hydra': return '#3a8a5a';
    case 'forge_golem': return '#6d6f78';
    case 'siege_dragon': return '#bf6b5b';
    case 'gate_keeper': return '#bf6b5b';
    default: return '#8b9aab';
  }
}

export function BossHPBar() {
  const agents = useGameState((s) => s.agents);
  const bosses = useGameState((s) => s.bosses);
  const agentList = [...agents.values()];
  const activeAgents = agentList.filter((a) => !a.isComplete);
  const blockedCount = activeAgents.filter(
    (a) =>
      a.isBlocked ||
      a.currentAction === "error" ||
      a.currentAction === "blocked"
  ).length;

  const aliveBosses = [...bosses.values()].filter((b) => b.isAlive);

  const [pulseAlpha, setPulseAlpha] = useState(0);
  const rafRef = useRef<number | null>(null);
  const startTsRef = useRef<number>(performance.now());

  const threatLevel =
    activeAgents.length > 0 ? blockedCount / activeAgents.length : 0;
  const shouldPulse = threatLevel > 0.5 || aliveBosses.length > 0;

  useEffect(() => {
    if (!shouldPulse) {
      setPulseAlpha(0);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    startTsRef.current = performance.now();

    function tick(now: number) {
      const elapsed = (now - startTsRef.current) / 1000;
      const alpha = Math.max(0, Math.sin((elapsed / 1.5) * Math.PI) * 0.5);
      setPulseAlpha(alpha);
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [shouldPulse]);

  if (blockedCount === 0 && aliveBosses.length === 0 && activeAgents.length === 0) return null;

  const fillColor = getThreatColor(threatLevel);
  const boxShadow =
    pulseAlpha > 0
      ? `0 0 8px rgba(191, 107, 91, ${pulseAlpha.toFixed(3)})`
      : "none";

  return (
    <div style={styles.container}>
      {/* Active bosses */}
      {aliveBosses.map((boss) => (
        <div key={boss.bossId} style={styles.bossEntry}>
          <div style={{ ...styles.bossName, color: getBossColor(boss.bossType) }}>
            {boss.name}
          </div>
          <div style={styles.barBg}>
            <div
              style={{
                ...styles.barFill,
                width: `${(boss.currentHP / boss.maxHP) * 100}%`,
                backgroundColor: getBossColor(boss.bossType),
                boxShadow,
              }}
            />
          </div>
          <div style={styles.bossHP}>
            {boss.currentHP} / {boss.maxHP} HP
            {boss.reason && <span style={styles.bossReason}> — {boss.reason.slice(0, 30)}</span>}
          </div>
        </div>
      ))}
      {/* Threat level */}
      {blockedCount > 0 && (
        <>
          <div style={styles.header}>DUNGEON THREAT</div>
          <div style={styles.barBg}>
            <div
              style={{
                ...styles.barFill,
                width: `${threatLevel * 100}%`,
                backgroundColor: fillColor,
                boxShadow,
              }}
            />
          </div>
          <div style={styles.label}>
            {blockedCount}/{activeAgents.length} agents in peril
          </div>
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: "6px 8px",
    marginTop: 4,
    borderTop: "1px solid #3f4147",
    fontFamily: "monospace",
  },
  header: {
    fontSize: 10,
    color: "#6d6f78",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 4,
  },
  barBg: {
    width: "100%",
    height: 8,
    background: "#1e1f22",
    borderRadius: 4,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 4,
    transition: "width 0.5s ease, background-color 0.5s ease",
  },
  label: {
    marginTop: 4,
    fontSize: 10,
    color: "#8b9aab",
  },
  bossEntry: {
    marginBottom: 6,
  },
  bossName: {
    fontSize: 10,
    fontWeight: "bold" as const,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    marginBottom: 2,
  },
  bossHP: {
    marginTop: 2,
    fontSize: 9,
    color: "#8b9aab",
  },
  bossReason: {
    color: "#6d6f78",
    fontStyle: "italic" as const,
  },
};
