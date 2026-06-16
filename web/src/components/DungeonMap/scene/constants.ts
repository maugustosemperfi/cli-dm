import type { DAGSnapshot } from "../../../protocol/events";
import type {
  ToolFlowEntry,
  ErrorPropagation,
  RoomMetrics,
  BurnRate,
  RoomHistory,
} from "../../../stores/gameState";
import { useGameState } from "../../../stores/gameState";
import type { NodeWeight } from "../layout";
import type { Corridor } from "../Corridor";
import type { SyncTier } from "../../../lib/scenePerf";

/** Render layers for the `world` container. Higher = drawn on top. */
export const Z = {
  grid: 0,
  fog: 1,
  corridor: 5,
  torch: 6,
  room: 20,
  creature: 25,
  pet: 30,
  door: 35,
  boss: 36,
  agent: 40,
  loot: 45,
  banner: 50,
  dayNight: 100,
} as const;

export interface SceneOverlay {
  toolFlows: ToolFlowEntry[];
  errorPropagations: ErrorPropagation[];
  roomMetrics: Map<string, RoomMetrics>;
  burnRates: Map<string, BurnRate>;
  roomHistory: Map<string, RoomHistory>;
}

export type SyncMode = SyncTier | "full";

export function topoKeyOf(dag: DAGSnapshot): string {
  return (
    dag.nodes.map((n) => n.nodeId).sort().join(",") +
    "|" +
    dag.edges.map((e) => `${e.from}>${e.to}`).sort().join(",")
  );
}

export function buildNodeWeights(roomMetrics: Map<string, RoomMetrics>): NodeWeight[] {
  const nodeWeights: NodeWeight[] = [];
  if (roomMetrics.size === 0) return nodeWeights;
  let maxTokens = 1;
  for (const m of roomMetrics.values()) maxTokens = Math.max(maxTokens, m.totalTokens);
  for (const [nodeId, m] of roomMetrics) {
    nodeWeights.push({ nodeId, weight: Math.min(1, m.totalTokens / maxTokens) });
  }
  return nodeWeights;
}

export function buildCorridorLookup(corridors: Corridor[]) {
  const corridorMap = new Map<string, Corridor>();
  const connectedPairs = new Set<string>();
  for (const c of corridors) {
    const fk = `${c.fromNode.nodeId}:${c.toNode.nodeId}`;
    const tk = `${c.toNode.nodeId}:${c.fromNode.nodeId}`;
    corridorMap.set(fk, c);
    corridorMap.set(tk, c);
    connectedPairs.add(fk);
    connectedPairs.add(tk);
  }
  return { corridorMap, connectedPairs };
}

export function pickSceneOverlay(state: ReturnType<typeof useGameState.getState>): SceneOverlay {
  return {
    toolFlows: state.toolFlows,
    errorPropagations: state.errorPropagations,
    roomMetrics: state.roomMetrics,
    burnRates: state.burnRates,
    roomHistory: state.roomHistory,
  };
}
