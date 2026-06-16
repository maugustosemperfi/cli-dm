import type { MapLayer, AgentState } from "../../../../stores/gameState";
import type { SceneOverlay } from "../constants";
import type { SceneRefs } from "../sceneRefs";
import type { LayoutResult } from "../../layout";
import type { CorridorGraph } from "./syncSelection";

export function syncOverlays(
  refs: SceneRefs,
  layout: LayoutResult,
  overlay: SceneOverlay,
  activeLayer: MapLayer,
  graph: CorridorGraph,
): void {
  const { toolFlows, errorPropagations, roomMetrics, burnRates } = overlay;
  const { corridorMap } = graph;
  const rooms = refs.roomsRef.current;

  const fog = refs.fogRef.current;
  if (fog) {
    for (const ln of layout.nodes) fog.setCell(ln.nodeId, ln.x, ln.y);
  }

  const flowCutoff = Date.now() - 10000;
  for (const flow of toolFlows) {
    if (flow.ts < flowCutoff) continue;
    const key = `${flow.fromNodeId}:${flow.toNodeId}`;
    const c = corridorMap.get(key);
    if (c) c.addFlow(flow.agentRole);
  }

  for (const prop of errorPropagations) {
    if (prop.intensity < 0.05) continue;
    for (let i = 0; i < prop.affectedNodes.length - 1; i++) {
      const key = `${prop.affectedNodes[i]}:${prop.affectedNodes[i + 1]}`;
      const c = corridorMap.get(key);
      if (c) c.ignite(prop.intensity);
      if (prop.sourceNodeId) {
        const sKey = `${prop.sourceNodeId}:${prop.affectedNodes[i]}`;
        const sc = corridorMap.get(sKey);
        if (sc) sc.ignite(prop.intensity * 0.7);
      }
    }
  }

  let totalTokensAll = 0;
  for (const br of burnRates.values()) totalTokensAll += br.totalTokens;
  const tokenFlowCutoff = Date.now() - 5000;

  for (const corridor of refs.corridorsRef.current) {
    const fromId = corridor.fromNode.nodeId;
    const toId = corridor.toNode.nodeId;
    const fromBurn = burnRates.get(fromId);
    const toBurn = burnRates.get(toId);
    const maxRate = Math.max(fromBurn?.ratePerMin ?? 0, toBurn?.ratePerMin ?? 0);
    corridor.setBurnIntensity(maxRate);

    if (totalTokensAll > 0) {
      const fromRatio = (fromBurn?.totalTokens ?? 0) / totalTokensAll;
      const toRatio = (toBurn?.totalTokens ?? 0) / totalTokensAll;
      corridor.setBottleneck(Math.max(fromRatio, toRatio));
    }

    for (const burn of [fromBurn, toBurn]) {
      if (!burn) continue;
      const recentTokens = burn.tokenHistory
        .filter((h) => h.ts >= tokenFlowCutoff)
        .reduce((s, h) => s + h.tokens, 0);
      if (recentTokens > 0) corridor.addTokenFlow(recentTokens);
    }
  }

  for (const [nodeId, room] of rooms) {
    const br = burnRates.get(nodeId);
    if (br) room.setCostDisplay(br.totalTokens, br.totalCostUSD);
  }

  let maxTokens = 0;
  let maxErrors = 0;
  for (const m of roomMetrics.values()) {
    if (m.totalTokens > maxTokens) maxTokens = m.totalTokens;
    if (m.errorCount > maxErrors) maxErrors = m.errorCount;
  }
  if (maxTokens === 0) maxTokens = 1;
  if (maxErrors === 0) maxErrors = 1;

  for (const [nodeId, room] of rooms) {
    const metrics = roomMetrics.get(nodeId) ?? null;
    room.setOverlay(activeLayer, metrics, maxTokens, maxErrors);
  }

  for (const corridor of refs.corridorsRef.current) {
    const fromMetrics = roomMetrics.get(corridor.fromNode.nodeId) ?? null;
    const toMetrics = roomMetrics.get(corridor.toNode.nodeId) ?? null;
    corridor.setOverlay(activeLayer, fromMetrics, toMetrics, maxTokens, maxErrors);
  }
}

export function syncFogVisibility(
  refs: SceneRefs,
  layout: LayoutResult,
  agents: Map<string, AgentState>,
  connectedPairs: Set<string>,
): void {
  const fog = refs.fogRef.current;
  if (!fog) return;

  const allVisited = new Set<string>();
  for (const agent of agents.values()) {
    if (agent.visitedRooms) {
      for (const roomId of agent.visitedRooms) allVisited.add(roomId);
    }
  }
  const adjacency = new Map<string, string[]>();
  for (const ln of layout.nodes) adjacency.set(ln.nodeId, []);
  for (const key of connectedPairs) {
    const [a, b] = key.split(":");
    adjacency.get(a)?.push(b);
  }
  fog.updateVisibility(allVisited, adjacency);
}
