import type { DAGSnapshot } from "../../../../protocol/events";
import type { AgentState } from "../../../../stores/gameState";
import { useGameState } from "../../../../stores/gameState";
import { recordSyncTier } from "../../../../lib/scenePerf";
import { computeLayout, type LayoutResult } from "../../layout";
import { buildNodeWeights, topoKeyOf, type SyncMode } from "../constants";
import type { SceneRefs } from "../sceneRefs";
import { syncSelection, syncDagStatus } from "./syncSelection";
import { syncRooms, syncCorridors } from "./syncRooms";
import { syncOverlays, syncFogVisibility } from "./syncOverlays";
import { syncAgents } from "./syncAgents";

export interface RunSceneSyncDeps {
  refs: SceneRefs;
  selectAgent: (id: string) => void;
  publishSceneCounts: () => void;
}

export function runSceneSync(
  deps: RunSceneSyncDeps,
  mode: SyncMode,
  dag: DAGSnapshot,
  agents: Map<string, AgentState>,
  selectedAgent?: string | null,
): void {
  const { refs, selectAgent, publishSceneCounts } = deps;
  const world = refs.worldRef.current;
  if (!world) return;

  if (mode === "T3") {
    syncSelection(refs, dag, selectedAgent, publishSceneCounts);
    return;
  }

  if (mode === "dag") {
    syncDagStatus(refs, dag, agents, publishSceneCounts);
    return;
  }

  const doT0 = mode === "T0" || mode === "full";
  const doT1 = mode === "T1" || mode === "full";
  const doT2 = mode === "T2" || mode === "full";
  if (doT0) recordSyncTier("T0");
  if (doT2) recordSyncTier("T2");
  if (doT1) recordSyncTier("T1");

  const overlay = refs.sceneOverlayRef.current;
  const activeLayer = useGameState.getState().activeLayer;

  const nodeWeights = buildNodeWeights(overlay.roomMetrics);
  const weightsKey = nodeWeights.map((w) => `${w.nodeId}:${w.weight}`).join(",");
  const topoKey = topoKeyOf(dag);
  const needsLayoutFresh =
    doT0 ||
    doT2 ||
    !refs.layoutCacheRef.current ||
    refs.layoutCacheRef.current.topoKey !== topoKey ||
    refs.layoutCacheRef.current.weightsKey !== weightsKey;

  let layout: LayoutResult;
  if (needsLayoutFresh) {
    layout = computeLayout(dag, nodeWeights, refs.prevNodeIdsRef.current ?? undefined);
    refs.layoutCacheRef.current = { layout, topoKey, weightsKey };
  } else {
    layout = refs.layoutCacheRef.current!.layout;
  }

  const topoChanged = topoKey !== refs.prevTopoKeyRef.current;
  if (topoChanged && doT0) refs.prevTopoKeyRef.current = topoKey;

  if (doT0 || doT2) {
    const currentNodeIds = new Set<string>();
    for (const ln of layout.nodes) currentNodeIds.add(ln.nodeId);
    refs.prevNodeIdsRef.current = currentNodeIds;
  }

  const sel = selectedAgent ?? useGameState.getState().selectedAgent;
  const flags = { doT0, doT1, doT2 };

  syncRooms(
    world,
    refs,
    dag,
    agents,
    layout,
    flags,
    sel,
    selectAgent,
    overlay.roomHistory,
    overlay.errorPropagations,
  );

  const graph = syncCorridors(world, refs, dag, layout, topoChanged, doT0, doT1, doT2);

  if (doT2) {
    syncOverlays(refs, layout, overlay, activeLayer, graph);
  }

  if (doT1) {
    syncFogVisibility(refs, layout, agents, graph.connectedPairs);
    syncAgents(world, refs, dag, agents, layout, graph, selectAgent);
  }

  publishSceneCounts();
}
