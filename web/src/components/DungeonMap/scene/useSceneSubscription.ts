import { useEffect, type RefObject } from "react";
import type { DAGSnapshot } from "../../../protocol/events";
import type { AgentState } from "../../../stores/gameState";
import { useGameState } from "../../../stores/gameState";
import { pickSceneOverlay, topoKeyOf, type SyncMode } from "./constants";
import type { SceneOverlay } from "./constants";
import type { SceneRefs } from "./sceneRefs";
import { purgeSceneOnClear, purgeSceneOnPrune } from "./purgeScene";

type SyncFn = (mode: SyncMode, dag: DAGSnapshot, agents: Map<string, AgentState>, selectedAgent?: string | null) => void;

export function useSceneSubscription(
  refs: SceneRefs,
  syncSceneRef: RefObject<SyncFn>,
) {
  useEffect(() => {
    let lastTopo = topoKeyOf(useGameState.getState().dag);
    syncSceneRef.current!("full", useGameState.getState().dag, useGameState.getState().agents);

    return useGameState.subscribe((s, prev) => {
      if (s.scenePurgeToken !== prev.scenePurgeToken) {
        if (s.scenePurgeKind === "clear") {
          purgeSceneOnClear(refs);
        } else if (s.scenePurgeKind === "prune") {
          purgeSceneOnPrune(refs, prev.agents, s.agents);
        }
      }

      const overlayChanged =
        s.toolFlows !== prev.toolFlows ||
        s.errorPropagations !== prev.errorPropagations ||
        s.roomMetrics !== prev.roomMetrics ||
        s.burnRates !== prev.burnRates ||
        s.roomHistory !== prev.roomHistory ||
        s.activeLayer !== prev.activeLayer;

      if (overlayChanged) {
        refs.sceneOverlayRef.current = pickSceneOverlay(s);
      }

      const agentsChanged = s.agents !== prev.agents;
      const dagChanged = s.dag !== prev.dag;
      const selectedChanged = s.selectedAgent !== prev.selectedAgent;
      const topo = topoKeyOf(s.dag);
      const topologyChanged = dagChanged && topo !== lastTopo;

      const sync = syncSceneRef.current!;

      if (topologyChanged) {
        lastTopo = topo;
        sync("T0", s.dag, s.agents);
        sync("T2", s.dag, s.agents);
        sync("T1", s.dag, s.agents);
        return;
      }

      if (agentsChanged && overlayChanged) {
        sync("T1", s.dag, s.agents);
        sync("T2", s.dag, s.agents);
        return;
      }

      if (agentsChanged) {
        sync("T1", s.dag, s.agents);
        return;
      }

      if (overlayChanged) {
        sync("T2", s.dag, s.agents);
        return;
      }

      if (dagChanged) {
        sync("dag", s.dag, s.agents);
        return;
      }

      if (selectedChanged) {
        sync("T3", s.dag, s.agents, s.selectedAgent);
      }
    });
  }, [refs, syncSceneRef]);
}

export function useReducedEffectsCleanup(refs: SceneRefs, reducedEffects: boolean) {
  useEffect(() => {
    if (!reducedEffects) return;
    const world = refs.worldRef.current;
    if (!world) return;
    for (const c of refs.creaturesRef.current) {
      world.removeChild(c);
      c.destroy();
    }
    refs.creaturesRef.current = [];
  }, [refs, reducedEffects]);
}

export type { SceneOverlay };
