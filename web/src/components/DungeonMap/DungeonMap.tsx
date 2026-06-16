import { useCallback, useEffect, useState } from "react";
import { useGameState } from "../../stores/gameState";
import { Minimap } from "../Minimap/Minimap";
import { LayerControls } from "./LayerControls";
import { useSceneRefs } from "./scene/sceneRefs";
import { usePixiApp } from "./scene/usePixiApp";
import { useSceneSync } from "./scene/useSceneSync";
import { useReducedEffectsCleanup, useSceneSubscription } from "./scene/useSceneSubscription";

export function DungeonMap() {
  const refs = useSceneRefs();
  const [error, setError] = useState<string | null>(null);

  const reducedEffects = useGameState((s) => s.reducedEffects);
  const selectAgent = useGameState((s) => s.selectAgent);
  const focusNodeId = useGameState((s) => s.focusNodeId);
  const focusOnNode = useGameState((s) => s.focusOnNode);

  usePixiApp(refs, setError);
  const { syncSceneRef } = useSceneSync(refs, selectAgent);
  useSceneSubscription(refs, syncSceneRef);
  useReducedEffectsCleanup(refs, reducedEffects);

  const handleMinimapClick = useCallback((worldX: number, worldY: number) => {
    refs.cameraRef.current?.focusOn(worldX, worldY, true);
  }, [refs]);

  useEffect(() => {
    if (!focusNodeId) return;
    const room = refs.roomsRef.current.get(focusNodeId);
    const camera = refs.cameraRef.current;
    if (room && camera) {
      camera.focusOn(room.position.x + 90, room.position.y + 35, true);
    }
    focusOnNode(null);
  }, [focusNodeId, focusOnNode, refs]);

  if (error) {
    return (
      <div style={{ padding: 20, color: "#bf6b5b", fontFamily: "monospace", fontSize: 13 }}>
        <div>PixiJS failed to initialize:</div>
        <pre style={{ marginTop: 8, color: "#8b9aab" }}>{error}</pre>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
      <div ref={refs.containerRef} style={{ width: "100%", height: "100%" }} />
      <LayerControls />
      <Minimap camera={refs.cameraRef.current} onClickWorld={handleMinimapClick} />
    </div>
  );
}
