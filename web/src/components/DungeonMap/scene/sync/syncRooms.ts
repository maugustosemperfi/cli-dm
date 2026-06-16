import type { Container } from "pixi.js";
import type { DAGSnapshot } from "../../../../protocol/events";
import type { AgentState, ErrorPropagation, RoomHistory } from "../../../../stores/gameState";
import { RoomNode } from "../../RoomNode";
import { Corridor } from "../../Corridor";
import { TorchLight } from "../../TorchLight";
import { Z } from "../constants";
import type { SceneRefs } from "../sceneRefs";
import type { LayoutResult } from "../../layout";
import { buildCorridorLookup } from "../constants";
import type { CorridorGraph } from "./syncSelection";

export interface RoomSyncFlags {
  doT0: boolean;
  doT1: boolean;
  doT2: boolean;
}

export function syncRooms(
  world: Container,
  refs: SceneRefs,
  dag: DAGSnapshot,
  agents: Map<string, AgentState>,
  layout: LayoutResult,
  flags: RoomSyncFlags,
  sel: string | null,
  selectAgent: (id: string) => void,
  roomHistory: Map<string, RoomHistory>,
  errorPropagations: ErrorPropagation[],
): void {
  const { doT0, doT1, doT2 } = flags;
  const rooms = refs.roomsRef.current;
  const seen = doT0 ? new Set<string>() : null;

  for (const ln of layout.nodes) {
    if (doT0) seen!.add(ln.nodeId);
    const dn = dag.nodes.find((n) => n.nodeId === ln.nodeId);
    if (!dn) continue;

    let room = rooms.get(ln.nodeId);
    if (!room && doT0) {
      room = new RoomNode(ln.nodeId, dn.label, ln.x, ln.y);
      room.on("pointertap", () => {
        if (dn.assignee) selectAgent(dn.assignee);
      });
      room.on("rightclick", (e: { preventDefault?: () => void; globalX?: number; clientX?: number; globalY?: number; clientY?: number }) => {
        e.preventDefault?.();
        const aa = agents.get(dn.assignee ?? "");
        window.dispatchEvent(new CustomEvent("cli-dm:command-palette", {
          detail: {
            x: e.globalX ?? e.clientX ?? 300,
            y: e.globalY ?? e.clientY ?? 300,
            agentId: dn.assignee ?? null,
            agentName: aa?.name ?? dn.label,
            nodeId: dn.nodeId,
          },
        }));
      });
      rooms.set(ln.nodeId, room);
      room.zIndex = Z.room;
      world.addChild(room);
      if (ln.isNew) {
        room.alpha = 0;
        room.scale.set(0.3);
      }
    }
    if (!room) continue;

    if (doT0 || doT2) {
      room.position.set(ln.x - 90, ln.y - 35);
      const targetScale = ln.scale;
      const curScale = room.scale.x;
      if (Math.abs(curScale - targetScale) > 0.01) {
        room.scale.set(curScale + (targetScale - curScale) * 0.2);
      }
      if (room.alpha < 1) {
        room.alpha = Math.min(1, room.alpha + 0.15);
      }
    }

    if (doT1 || doT2) {
      const aa = agents.get(dn.assignee ?? "");
      room.update(dn.status, aa?.name, aa?.role, aa?.currentAction);
      if (aa) {
        const tier = aa.level >= 8 ? 4 : aa.level >= 5 ? 3 : aa.level >= 3 ? 2 : 1;
        room.setTier(tier);
      }
      room.setHeat(aa?.activityHeat ?? 0);
      room.highlight(dn.assignee === sel);
    }

    if (doT2) {
      const rh = roomHistory.get(ln.nodeId);
      if (rh) room.updateDecorations(rh);
      for (const prop of errorPropagations) {
        if (prop.intensity < 0.05) continue;
        if (prop.affectedNodes.includes(ln.nodeId)) {
          const isSource = prop.sourceNodeId === ln.nodeId;
          room.setFire(isSource ? prop.intensity : prop.intensity * 0.5);
        }
      }
    }
  }

  if (doT0) {
    for (const [id, r] of rooms) {
      if (!seen!.has(id)) {
        world.removeChild(r);
        r.destroy();
        rooms.delete(id);
      }
    }
  }
}

export function syncCorridors(
  world: Container,
  refs: SceneRefs,
  dag: DAGSnapshot,
  layout: LayoutResult,
  topoChanged: boolean,
  doT0: boolean,
  doT1: boolean,
  doT2: boolean,
): CorridorGraph {
  let corridorMap = new Map<string, Corridor>();
  let connectedPairs = new Set<string>();

  if (doT0 && topoChanged) {
    for (const c of refs.corridorsRef.current) {
      world.removeChild(c);
      c.destroy();
    }
    refs.corridorsRef.current = [];

    for (const edge of layout.edges) {
      const c = new Corridor(edge.from, edge.to);
      const fd = dag.nodes.find((n) => n.nodeId === edge.from.nodeId);
      const td = dag.nodes.find((n) => n.nodeId === edge.to.nodeId);
      if (fd && td) c.update(fd.status, td.status, false);
      refs.corridorsRef.current.push(c);
      corridorMap.set(`${edge.from.nodeId}:${edge.to.nodeId}`, c);
      corridorMap.set(`${edge.to.nodeId}:${edge.from.nodeId}`, c);
      connectedPairs.add(`${edge.from.nodeId}:${edge.to.nodeId}`);
      connectedPairs.add(`${edge.to.nodeId}:${edge.from.nodeId}`);
      c.zIndex = Z.corridor;
      world.addChildAt(c, 1);
    }

    const gridLookup = new Map<string, (typeof layout.nodes)[0]>();
    for (const ln of layout.nodes) {
      gridLookup.set(`${ln.gridCol},${ln.gridRow}`, ln);
    }
    const directions: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const ln of layout.nodes) {
      for (const [dc, dr] of directions) {
        const neighbor = gridLookup.get(`${ln.gridCol + dc},${ln.gridRow + dr}`);
        if (!neighbor) continue;
        const key = `${ln.nodeId}:${neighbor.nodeId}`;
        if (connectedPairs.has(key)) continue;
        const c = new Corridor(ln, neighbor);
        refs.corridorsRef.current.push(c);
        corridorMap.set(key, c);
        corridorMap.set(`${neighbor.nodeId}:${ln.nodeId}`, c);
        connectedPairs.add(key);
        connectedPairs.add(`${neighbor.nodeId}:${ln.nodeId}`);
        c.zIndex = Z.corridor;
        world.addChildAt(c, 1);
      }
    }

    for (const t of refs.torchesRef.current) {
      world.removeChild(t);
      t.destroy();
    }
    refs.torchesRef.current = [];
    for (const corridor of refs.corridorsRef.current) {
      const STEPS = 24;
      for (const pct of [0.25, 0.75]) {
        const idx = Math.floor(STEPS * pct);
        const pt = corridor.getSpinePoint(idx);
        const nm = corridor.getNormal(idx);
        if (pt && nm) {
          const t1 = new TorchLight(pt[0] + nm[0] * 22, pt[1] + nm[1] * 22, false);
          const t2 = new TorchLight(pt[0] - nm[0] * 22, pt[1] - nm[1] * 22, true);
          t1.zIndex = Z.torch;
          t2.zIndex = Z.torch;
          refs.torchesRef.current.push(t1, t2);
          world.addChildAt(t1, 2);
          world.addChildAt(t2, 2);
        }
      }
    }
  } else if (doT1 || doT2) {
    ({ corridorMap, connectedPairs } = buildCorridorLookup(refs.corridorsRef.current));
  }

  return { corridorMap, connectedPairs };
}
