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

/**
 * Compute 2D grid layout from a DAG snapshot.
 *
 * - When DAG edges exist: depth → column, index-within-layer → row
 *   (preserves left-to-right dependency flow)
 * - When no edges: arrange in a roughly-square grid (row-major)
 */
export function computeLayout(dag: DAGSnapshot): LayoutResult {
  if (dag.nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0, gridCols: 0, gridRows: 0 };
  }

  const N = dag.nodes.length;
  const hasEdges = dag.edges.length > 0;
  const nodeMap = new Map<string, LayoutNode>();
  const layoutNodes: LayoutNode[] = [];
  let gridCols: number;
  let gridRows: number;

  if (!hasEdges) {
    // No DAG edges — arrange in a roughly-square grid
    gridCols = Math.ceil(Math.sqrt(N));
    gridRows = Math.ceil(N / gridCols);

    for (let i = 0; i < N; i++) {
      const col = i % gridCols;
      const row = Math.floor(i / gridCols);
      const node: LayoutNode = {
        nodeId: dag.nodes[i].nodeId,
        x: PADDING + col * GRID_COL_SPACING,
        y: PADDING + row * GRID_ROW_SPACING,
        layer: col,
        index: row,
        gridCol: col,
        gridRow: row,
      };
      layoutNodes.push(node);
      nodeMap.set(node.nodeId, node);
    }
  } else {
    // Has edges — topological BFS to assign depth, then grid from depth/index
    const outgoing = new Map<string, string[]>();
    const incoming = new Map<string, string[]>();
    for (const node of dag.nodes) {
      outgoing.set(node.nodeId, []);
      incoming.set(node.nodeId, []);
    }
    for (const edge of dag.edges) {
      outgoing.get(edge.from)?.push(edge.to);
      incoming.get(edge.to)?.push(edge.from);
    }

    const depth = new Map<string, number>();
    const inDegree = new Map<string, number>();
    for (const node of dag.nodes) {
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
    for (const node of dag.nodes) {
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
      for (let ni = 0; ni < layer.length; ni++) {
        const node: LayoutNode = {
          nodeId: layer[ni],
          x: PADDING + li * GRID_COL_SPACING,
          y: PADDING + ni * GRID_ROW_SPACING,
          layer: li,
          index: ni,
          gridCol: li,
          gridRow: ni,
        };
        layoutNodes.push(node);
        nodeMap.set(node.nodeId, node);
      }
    }
  }

  // Build edges with resolved positions
  const layoutEdges: LayoutEdge[] = [];
  for (const edge of dag.edges) {
    const from = nodeMap.get(edge.from);
    const to = nodeMap.get(edge.to);
    if (from && to) {
      layoutEdges.push({ from, to });
    }
  }

  const width = PADDING * 2 + Math.max(0, gridCols - 1) * GRID_COL_SPACING;
  const height = PADDING * 2 + Math.max(0, gridRows - 1) * GRID_ROW_SPACING;

  return { nodes: layoutNodes, edges: layoutEdges, width, height, gridCols, gridRows };
}
