import type { DAGSnapshot } from "../../protocol/events";
import { GRID_COL_SPACING, GRID_ROW_SPACING, PADDING } from "./theme";

export interface LayoutNode {
  nodeId: string;
  x: number;
  y: number;
  layer: number;
  index: number;
  gridCol: number;
  gridRow: number;
  /** Visual scale multiplier (0.8–1.3). Larger rooms = more activity. */
  scale: number;
  /** True for nodes with no outgoing edges (dead-end branches). */
  isLeaf: boolean;
  /** True for the node just added (for growth animation). */
  isNew?: boolean;
}

export interface LayoutEdge {
  from: LayoutNode;
  to: LayoutNode;
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  gridCols: number;
  gridRows: number;
}

/** Per-node weight hint for variable sizing (optional, passed from gameState). */
export interface NodeWeight {
  nodeId: string;
  /** 0–1 normalized weight (token cost, action count, etc.) */
  weight: number;
}

// ── Deterministic pseudo-random from node ID ────────────────────────────────

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Returns a deterministic float in [-1, 1] for the given seed. */
function seededRand(seed: number, salt: number): number {
  const h = hashStr(`${seed}:${salt}`);
  return (h / 0xffffffff) * 2 - 1;
}

// ── Jitter & organic offset helpers ─────────────────────────────────────────

const JITTER_X = 35; // max horizontal jitter (px)
const JITTER_Y = 25; // max vertical jitter (px)
const LEAF_ANGLE_MIN = 0.25; // radians (~14°)
const LEAF_ANGLE_MAX = 0.6;  // radians (~34°)
const LEAF_OFFSET = 40;      // extra offset distance for dead-ends

/**
 * Compute 2D layout from a DAG snapshot with organic jitter.
 *
 * - Base placement: topological BFS assigns depth → column, layer index → row
 * - Organic layer: deterministic per-node jitter, leaf-node angular offsets,
 *   and variable scale based on optional weight hints.
 * - When no edges: arrange in a roughly-square grid with jitter.
 *
 * @param dag       The current DAG snapshot
 * @param weights   Optional per-node weight hints for variable sizing
 * @param prevNodes Previous layout nodes (to detect new nodes for animation)
 */
export function computeLayout(
  dag: DAGSnapshot,
  weights?: NodeWeight[],
  prevNodeIds?: Set<string>,
): LayoutResult {
  if (dag.nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0, gridCols: 0, gridRows: 0 };
  }

  // Stable ordering — backend snapshots may arrive in arbitrary order; grid slots
  // are index-based so sort here to keep room positions fixed across recomputes.
  const nodes = [...dag.nodes].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
  const dagSorted: DAGSnapshot = { nodes, edges: dag.edges };

  const N = nodes.length;
  const hasEdges = dagSorted.edges.length > 0;
  const nodeMap = new Map<string, LayoutNode>();
  const layoutNodes: LayoutNode[] = [];
  let gridCols: number;
  let gridRows: number;

  // Build weight lookup
  const weightMap = new Map<string, number>();
  if (weights) {
    for (const w of weights) weightMap.set(w.nodeId, w.weight);
  }

  // Build adjacency for leaf detection
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const node of nodes) {
    outgoing.set(node.nodeId, []);
    incoming.set(node.nodeId, []);
  }
  for (const edge of dagSorted.edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.get(edge.to)?.push(edge.from);
  }

  if (!hasEdges) {
    // ── No DAG edges — jittered roughly-square grid ─────────────────────
    gridCols = Math.ceil(Math.sqrt(N));
    gridRows = Math.ceil(N / gridCols);

    for (let i = 0; i < N; i++) {
      const nodeId = nodes[i].nodeId;
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const hash = hashStr(nodeId);

      // Organic jitter (deterministic per node)
      const jx = seededRand(hash, 0) * JITTER_X;
      const jy = seededRand(hash, 1) * JITTER_Y;

      // Scale from weight (1.0 default, scales up with activity)
      const w = weightMap.get(nodeId) ?? 0;
      const scale = 1.0 + w * 0.3; // 1.0 → 1.3

      const node: LayoutNode = {
        nodeId,
        x: PADDING + col * GRID_COL_SPACING + jx,
        y: PADDING + row * GRID_ROW_SPACING + jy,
        layer: col,
        index: row,
        gridCol: col,
        gridRow: row,
        scale,
        isLeaf: true, // no edges means all are "leaves"
        isNew: prevNodeIds ? !prevNodeIds.has(nodeId) : false,
      };
      layoutNodes.push(node);
      nodeMap.set(nodeId, node);
    }
  } else {
    // ── Has edges — topological BFS with organic placement ──────────────
    const depth = new Map<string, number>();
    const inDegree = new Map<string, number>();
    for (const node of nodes) {
      inDegree.set(node.nodeId, incoming.get(node.nodeId)?.length ?? 0);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) {
        queue.push(id);
        depth.set(id, 0);
      }
    }

    let maxDepth = 0;
    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currDepth = depth.get(curr) ?? 0;
      for (const next of outgoing.get(curr) ?? []) {
        const d = currDepth + 1;
        if (d > (depth.get(next) ?? 0)) {
          depth.set(next, d);
        }
        const newDeg = (inDegree.get(next) ?? 1) - 1;
        inDegree.set(next, newDeg);
        if (newDeg === 0) {
          queue.push(next);
        }
        if ((depth.get(next) ?? 0) > maxDepth) {
          maxDepth = depth.get(next) ?? 0;
        }
      }
    }

    // Handle orphan nodes not reached by BFS
    for (const node of nodes) {
      if (!depth.has(node.nodeId)) {
        depth.set(node.nodeId, 0);
      }
    }

    // Group into layers
    const layers: string[][] = Array.from({ length: maxDepth + 1 }, () => []);
    for (const [id, d] of depth) {
      layers[d].push(id);
    }

    const maxLayerSize = Math.max(...layers.map((l) => l.length));
    gridCols = layers.length;
    gridRows = maxLayerSize;

    for (let li = 0; li < layers.length; li++) {
      const layer = layers[li];

      // Stagger odd layers slightly for organic feel
      const layerStagger = (li % 2 === 1) ? GRID_ROW_SPACING * 0.12 : 0;

      for (let ni = 0; ni < layer.length; ni++) {
        const nodeId = layer[ni];
        const hash = hashStr(nodeId);
        const isLeaf = (outgoing.get(nodeId)?.length ?? 0) === 0;
        const isRoot = (incoming.get(nodeId)?.length ?? 0) === 0;

        // Base grid position
        let baseX = PADDING + li * GRID_COL_SPACING;
        let baseY = PADDING + ni * GRID_ROW_SPACING + layerStagger;

        // Center layers vertically for a diamond/organic shape
        const layerSize = layer.length;
        const verticalOffset = ((maxLayerSize - layerSize) / 2) * GRID_ROW_SPACING;
        baseY += verticalOffset;

        // Organic jitter
        const jx = seededRand(hash, 0) * JITTER_X;
        const jy = seededRand(hash, 1) * JITTER_Y;

        // Dead-end branches get angular offset from their parent
        let leafOffsetX = 0;
        let leafOffsetY = 0;
        if (isLeaf && !isRoot) {
          const angle = LEAF_ANGLE_MIN + Math.abs(seededRand(hash, 2)) * (LEAF_ANGLE_MAX - LEAF_ANGLE_MIN);
          const sign = seededRand(hash, 3) > 0 ? 1 : -1;
          leafOffsetX = Math.cos(angle) * LEAF_OFFSET;
          leafOffsetY = Math.sin(angle) * LEAF_OFFSET * sign;
        }

        // Scale from weight (1.0 default, scales up with activity)
        const w = weightMap.get(nodeId) ?? 0;
        let scale = 1.0 + w * 0.3;
        // Leaves slightly smaller, roots slightly larger
        if (isLeaf) scale *= 0.92;
        if (isRoot && li === 0) scale = Math.max(scale, 1.05);

        const node: LayoutNode = {
          nodeId,
          x: baseX + jx + leafOffsetX,
          y: baseY + jy + leafOffsetY,
          layer: li,
          index: ni,
          gridCol: li,
          gridRow: ni,
          scale: Math.max(0.7, Math.min(1.4, scale)),
          isLeaf,
          isNew: prevNodeIds ? !prevNodeIds.has(nodeId) : false,
        };
        layoutNodes.push(node);
        nodeMap.set(nodeId, node);
      }
    }
  }

  // ── Separation pass — push overlapping rooms apart ──────────────────────
  const MIN_DIST = 160; // minimum distance between room centers
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < layoutNodes.length; i++) {
      for (let j = i + 1; j < layoutNodes.length; j++) {
        const a = layoutNodes[i];
        const b = layoutNodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_DIST && dist > 0) {
          const push = (MIN_DIST - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          a.x -= nx * push * 0.5;
          a.y -= ny * push * 0.5;
          b.x += nx * push * 0.5;
          b.y += ny * push * 0.5;
        }
      }
    }
  }

  // ── Build edges with resolved positions ─────────────────────────────────
  const layoutEdges: LayoutEdge[] = [];
  for (const edge of dagSorted.edges) {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (from && to) {
      layoutEdges.push({ from, to });
    }
  }

  // Compute bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of layoutNodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  const width = layoutNodes.length > 0 ? (maxX - minX + PADDING * 2) : 0;
  const height = layoutNodes.length > 0 ? (maxY - minY + PADDING * 2) : 0;

  return { nodes: layoutNodes, edges: layoutEdges, width, height, gridCols, gridRows };
}
