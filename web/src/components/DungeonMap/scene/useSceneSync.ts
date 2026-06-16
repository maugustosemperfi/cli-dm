import { useCallback, useRef } from "react";
import type { DAGSnapshot } from "../../../protocol/events";
import type { AgentState } from "../../../stores/gameState";
import { setSceneCounts } from "../../../lib/scenePerf";
import type { SyncMode } from "./constants";
import type { SceneRefs } from "./sceneRefs";
import { runSceneSync } from "./sync/runSceneSync";

export function useSceneSync(refs: SceneRefs, selectAgent: (id: string) => void) {
  const publishSceneCounts = useCallback(() => {
    setSceneCounts({
      rooms: refs.roomsRef.current.size,
      sprites: refs.spritesRef.current.size,
      corridors: refs.corridorsRef.current.length,
      creatures: refs.creaturesRef.current.length,
    });
  }, [refs]);

  const runSceneSyncFn = useCallback(
    (mode: SyncMode, dag: DAGSnapshot, agents: Map<string, AgentState>, selectedAgent?: string | null) => {
      runSceneSync({ refs, selectAgent, publishSceneCounts }, mode, dag, agents, selectedAgent);
    },
    [refs, selectAgent, publishSceneCounts],
  );

  const syncSceneRef = useRef(runSceneSyncFn);
  syncSceneRef.current = runSceneSyncFn;

  return { runSceneSync: runSceneSyncFn, syncSceneRef, publishSceneCounts };
}
