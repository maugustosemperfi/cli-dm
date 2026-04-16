import { useEffect, useRef, useCallback } from "react";
import type { DAGSnapshot } from "../../protocol/events";
import type { AgentState } from "../../stores/gameState";
import { AGENT_COLORS } from "../../stores/gameState";
import { computeLayout } from "../DungeonMap/layout";
import type { Camera } from "../DungeonMap/Camera";

const MINIMAP_W = 200;
const MINIMAP_H = 140;
const MINIMAP_PAD = 10;

interface MinimapProps {
  dag: DAGSnapshot;
  agents: Map<string, AgentState>;
  camera: Camera | null;
  onClickWorld: (worldX: number, worldY: number) => void;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "#4e5058",
  in_progress: "#5b8abf",
  completed: "#5baf7b",
  failed: "#bf6b5b",
  blocked: "#bfa85b",
};

export function Minimap({ dag, agents, camera, onClickWorld }: MinimapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const layout = computeLayout(dag);
    if (layout.nodes.length === 0) {
      ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
      rafRef.current = requestAnimationFrame(draw);
      return;
    }

    // Compute bounds of the layout
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of layout.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    // Add room size margin
    minX -= 100; minY -= 50;
    maxX += 100; maxY += 50;

    const worldW = maxX - minX || 1;
    const worldH = maxY - minY || 1;
    const drawW = MINIMAP_W - MINIMAP_PAD * 2;
    const drawH = MINIMAP_H - MINIMAP_PAD * 2;
    const scale = Math.min(drawW / worldW, drawH / worldH);

    const toMX = (wx: number) => MINIMAP_PAD + (wx - minX) * scale;
    const toMY = (wy: number) => MINIMAP_PAD + (wy - minY) * scale;

    // Clear
    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H);
    ctx.fillStyle = "rgba(30, 31, 34, 0.85)";
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);

    // Draw edges
    ctx.strokeStyle = "#3f4147";
    ctx.lineWidth = 1;
    for (const edge of layout.edges) {
      ctx.beginPath();
      ctx.moveTo(toMX(edge.from.x), toMY(edge.from.y));
      ctx.lineTo(toMX(edge.to.x), toMY(edge.to.y));
      ctx.stroke();
    }

    // Draw rooms
    for (const ln of layout.nodes) {
      const dn = dag.nodes.find((n) => n.nodeId === ln.nodeId);
      const color = STATUS_COLORS[dn?.status ?? "pending"] ?? STATUS_COLORS.pending;
      ctx.fillStyle = color;
      const rx = toMX(ln.x) - 6;
      const ry = toMY(ln.y) - 3;
      ctx.fillRect(rx, ry, 12, 6);
    }

    // Draw agent dots
    for (const agent of agents.values()) {
      const dn = dag.nodes.find((n) => n.assignee === agent.agentId);
      if (!dn) continue;
      const ln = layout.nodes.find((n) => n.nodeId === dn.nodeId);
      if (!ln) continue;
      const color = AGENT_COLORS[agent.role] ?? "#8b9aab";
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(toMX(ln.x), toMY(ln.y), 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw camera viewport
    if (camera) {
      const vp = camera.getViewport();
      const vpX = toMX(vp.x);
      const vpY = toMY(vp.y);
      const vpW = vp.width * scale;
      const vpH = vp.height * scale;
      ctx.strokeStyle = "rgba(219, 222, 225, 0.6)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vpX, vpY, vpW, vpH);
    }

    // Store transform for click handler
    (canvas as any).__minimapTransform = { minX, minY, scale };

    rafRef.current = requestAnimationFrame(draw);
  }, [dag, agents, camera]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const transform = (canvas as any).__minimapTransform;
      if (!transform) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const worldX = (mx - MINIMAP_PAD) / transform.scale + transform.minX;
      const worldY = (my - MINIMAP_PAD) / transform.scale + transform.minY;
      onClickWorld(worldX, worldY);
    },
    [onClickWorld]
  );

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP_W}
      height={MINIMAP_H}
      onClick={handleClick}
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        zIndex: 10,
        borderRadius: 4,
        border: "1px solid #3f4147",
        cursor: "crosshair",
      }}
    />
  );
}
