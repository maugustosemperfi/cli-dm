import type { DAGSnapshot } from "../../protocol/events";
import { LAYER_SPACING, NODE_SPACING, PADDING } from "./theme";

export interface LayoutNode {
  nodeId: string;
  x: number;
  y: number;
  layer: number;
  index: number;
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
}

/**
 * Compute Sugiyama-style layered layout from a DAG snapshot.
 * Mirrors the Go LayerAssignment algorithm.
 *
 * - Layers go left-to-right (layer 0 = leftmost, roots)
 * - Nodes within a layer go top-to-bottom
 * - Layers are centered vertically relative to the tallest layer
 */
export function computeLayout(dag: DAGSnapshot): LayoutResult {
  if (dag.nodes.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  // Build adjacency
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

  // Topological BFS — assign layers
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

  // Handle orphan nodes (no edges, not reached by BFS)
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

  // Find tallest layer for vertical centering
  const maxLayerSize = Math.max(...layers.map((l) => l.length));
  const totalHeight = PADDING * 2 + (maxLayerSize - 1) * NODE_SPACING;

  // Assign pixel positions
  const nodeMap = new Map<string, LayoutNode>();
  const layoutNodes: LayoutNode[] = [];

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const layerHeight = (layer.length - 1) * NODE_SPACING;
    const yOffset = (totalHeight - layerHeight) / 2;

    for (let ni = 0; ni < layer.length; ni++) {
      const node: LayoutNode = {
        nodeId: layer[ni],
        x: PADDING + li * LAYER_SPACING,
        y: yOffset + ni * NODE_SPACING,
        layer: li,
        index: ni,
      };
      layoutNodes.push(node);
      nodeMap.set(node.nodeId, node);
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

  const width = PADDING * 2 + maxDepth * LAYER_SPACING;
  const height = totalHeight;

  return { nodes: layoutNodes, edges: layoutEdges, width, height };
}
