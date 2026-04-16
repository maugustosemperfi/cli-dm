import { useEffect, useRef } from "react";
import { useGameState } from "../stores/gameState";
import { useWorldState } from "../stores/worldState";

const SYNC_INTERVAL_MS = 2000;

/**
 * Bridges gameState → worldState by periodically syncing
 * aggregated agent metrics into the current world session.
 * Also marks the session as completed on WebSocket disconnect.
 */
export function useWorldSync() {
  const agents = useGameState((s) => s.agents);
  const dag = useGameState((s) => s.dag);
  const connected = useGameState((s) => s.connected);

  const currentSessionId = useWorldState((s) => s.currentSessionId);
  const updateSession = useWorldState((s) => s.updateSession);

  const prevConnected = useRef(connected);
  const lastSync = useRef(0);

  useEffect(() => {
    if (!currentSessionId) return;

    // Detect WS disconnect: connected went true → false
    if (prevConnected.current && !connected) {
      updateSession(currentSessionId, {
        status: "completed",
        endedAt: Date.now(),
      });
    }
    prevConnected.current = connected;
  }, [connected, currentSessionId, updateSession]);

  useEffect(() => {
    if (!currentSessionId) return;

    const now = Date.now();
    if (now - lastSync.current < SYNC_INTERVAL_MS) return;
    lastSync.current = now;

    let totalXP = 0;
    let totalGold = 0;
    let totalTokens = 0;
    agents.forEach((a) => {
      totalXP += a.xp;
      totalGold += a.gold;
      totalTokens += a.tokens;
    });

    updateSession(currentSessionId, {
      agentCount: agents.size,
      taskCount: dag.nodes.length,
      totalXP,
      totalGold,
      totalTokens,
    });
  }, [agents, dag, currentSessionId, updateSession]);
}
