import type { Container } from "pixi.js";
import type { DAGSnapshot } from "../../../../protocol/events";
import type { AgentState } from "../../../../stores/gameState";
import { useGameState } from "../../../../stores/gameState";
import { recordSyncTier } from "../../../../lib/scenePerf";
import type { Corridor } from "../../Corridor";
import type { SceneRefs } from "../sceneRefs";

export function syncSelection(
  refs: SceneRefs,
  dag: DAGSnapshot,
  selectedAgent: string | null | undefined,
  publishSceneCounts: () => void,
) {
  recordSyncTier("T3");
  const sel = selectedAgent ?? useGameState.getState().selectedAgent;
  for (const room of refs.roomsRef.current.values()) {
    const dn = dag.nodes.find((n) => n.nodeId === room.nodeId);
    room.highlight(dn?.assignee === sel);
  }
  publishSceneCounts();
}

export function syncDagStatus(
  refs: SceneRefs,
  dag: DAGSnapshot,
  agents: Map<string, AgentState>,
  publishSceneCounts: () => void,
) {
  recordSyncTier("dag");
  for (const dn of dag.nodes) {
    const room = refs.roomsRef.current.get(dn.nodeId);
    if (!room) continue;
    const aa = agents.get(dn.assignee ?? "");
    room.update(dn.status, aa?.name, aa?.role, aa?.currentAction);
  }
  publishSceneCounts();
}

export interface CorridorGraph {
  corridorMap: Map<string, Corridor>;
  connectedPairs: Set<string>;
}

export function emptyCorridorGraph(): CorridorGraph {
  return { corridorMap: new Map(), connectedPairs: new Set() };
}

export type { Container };
