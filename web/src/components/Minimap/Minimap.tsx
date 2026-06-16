import { useEffect, useRef, useCallback } from "react";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";
import { computeLayout } from "../DungeonMap/layout";
import type { Camera } from "../DungeonMap/Camera";

const MINIMAP_W = 200;
const MINIMAP_H = 140;
const MINIMAP_PAD = 10;

interface MinimapProps {
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

// ── Building silhouettes (tiny 3-5px shapes per role) ───────────────────────

function drawMinimapBuilding(
  ctx: CanvasRenderingContext2D,
  role: string | undefined,
  x: number,
  y: number,
  size: number,
  color: string
) {
  ctx.fillStyle = color;

  switch (role) {
    case "warrior": // fortress with crenellations
      ctx.fillRect(x, y, size, size);
      ctx.fillRect(x - 1, y - 1, 2, 1);
      ctx.fillRect(x + size - 1, y - 1, 2, 1);
      break;
    case "mage": // tower with spire
      ctx.fillRect(x, y + 1, size, size - 1);
      ctx.fillRect(x + Math.floor(size / 2), y - 1, 1, 2);
      break;
    case "rogue": // tavern A-frame
      ctx.fillRect(x, y + 1, size, size - 1);
      ctx.fillRect(x + 1, y, size - 2, 1);
      break;
    case "ranger": // outpost/watchtower
      ctx.fillRect(x + 1, y, size - 2, size);
      ctx.fillRect(x, y + size - 1, size, 1);
      break;
    case "cleric": // chapel with cross-top
      ctx.fillRect(x, y + 1, size, size - 1);
      ctx.fillRect(x + Math.floor(size / 2), y - 1, 1, 2);
      ctx.fillRect(x + Math.floor(size / 2) - 1, y, 3, 1);
      break;
    case "bard": // theater with dome
      ctx.fillRect(x, y + 2, size, size - 2);
      ctx.fillRect(x + 1, y + 1, size - 2, 1);
      ctx.fillRect(x + 2, y, size - 4 || 1, 1);
      break;
    default: // plain rectangle
      ctx.fillRect(x, y, size, size);
      break;
  }
}

export function Minimap({ camera, onClickWorld }: MinimapProps) {
  const dag = useGameState((s) => s.dag);
  const agents = useGameState((s) => s.agents);
  const roomMetrics = useGameState((s) => s.roomMetrics);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ mx: 0, my: 0 });

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

    // Build set of all visited rooms (fog of war)
    const allVisited = new Set<string>();
    for (const agent of agents.values()) {
      if (agent.visitedRooms) {
        for (const roomId of agent.visitedRooms) allVisited.add(roomId);
      }
    }

    const now = Date.now();

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

    // Draw rooms as building silhouettes
    for (const ln of layout.nodes) {
      const dn = dag.nodes.find((n) => n.nodeId === ln.nodeId);
      const baseColor = STATUS_COLORS[dn?.status ?? "pending"] ?? STATUS_COLORS.pending;
      const isVisited = allVisited.has(ln.nodeId);

      // Fog of war: dim unvisited rooms
      ctx.globalAlpha = isVisited ? 1.0 : 0.3;

      // Find agent role for this room's building style
      const assignedAgent = dn?.assignee ? agents.get(dn.assignee) : undefined;
      const role = assignedAgent?.role;

      const rx = toMX(ln.x) - 4;
      const ry = toMY(ln.y) - 3;

      // Error overlay — red tint for rooms with errors
      const metrics = roomMetrics?.get(ln.nodeId);
      if (metrics && metrics.errorCount > 0) {
        const errorAlpha = Math.min(0.4, metrics.errorCount * 0.1) * ctx.globalAlpha;
        ctx.fillStyle = `rgba(191, 107, 91, ${errorAlpha})`;
        ctx.fillRect(rx - 1, ry - 1, 10, 8);
      }

      // Activity heat overlay — warm tint for high-activity rooms
      if (metrics && metrics.actionCount > 5) {
        const heatAlpha = Math.min(0.3, (metrics.actionCount - 5) * 0.02) * ctx.globalAlpha;
        ctx.fillStyle = `rgba(191, 168, 91, ${heatAlpha})`;
        ctx.fillRect(rx - 1, ry - 1, 10, 8);
      }

      // Draw building silhouette
      drawMinimapBuilding(ctx, role, rx, ry, 8, baseColor);

      ctx.globalAlpha = 1.0;
    }

    // Draw agent dots with pulsing
    for (const agent of agents.values()) {
      if (agent.isComplete) continue;
      const dn = dag.nodes.find((n) => n.assignee === agent.agentId);
      if (!dn) continue;
      const ln = layout.nodes.find((n) => n.nodeId === dn.nodeId);
      if (!ln) continue;
      const color = AGENT_COLORS[agent.role] ?? "#8b9aab";

      // Pulse: active agents oscillate radius
      const isActive = agent.currentAction !== "idle";
      const baseRadius = 2;
      const pulseRadius = isActive
        ? baseRadius + Math.sin(now * 0.006) * 0.8
        : baseRadius;

      ctx.fillStyle = color;
      ctx.globalAlpha = isActive ? 1.0 : 0.5;
      ctx.beginPath();
      ctx.arc(toMX(ln.x), toMY(ln.y), pulseRadius, 0, Math.PI * 2);
      ctx.fill();

      // Glow ring for active agents
      if (isActive) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.3 + Math.sin(now * 0.004) * 0.15;
        ctx.beginPath();
        ctx.arc(toMX(ln.x), toMY(ln.y), pulseRadius + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1.0;
    }

    // Draw camera viewport indicator
    if (camera) {
      const vp = camera.getViewport();
      const vpX = toMX(vp.x);
      const vpY = toMY(vp.y);
      const vpW = vp.width * scale;
      const vpH = vp.height * scale;

      // Semi-transparent blue fill
      ctx.fillStyle = "rgba(64, 128, 255, 0.1)";
      ctx.fillRect(vpX, vpY, vpW, vpH);

      // Border
      ctx.strokeStyle = "rgba(64, 128, 255, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vpX, vpY, vpW, vpH);
    }

    // Store transform for click/drag handler
    (canvas as any).__minimapTransform = { minX, minY, scale };

    rafRef.current = requestAnimationFrame(draw);
  }, [dag, agents, camera, roomMetrics]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  // Click handler — preserved from original
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isDraggingRef.current) return; // don't fire click on drag end
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

  // Drag-to-pan handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      isDraggingRef.current = false;
      dragStartRef.current = { mx: e.clientX, my: e.clientY };
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.buttons !== 1) return; // only drag with left button
      const dx = e.clientX - dragStartRef.current.mx;
      const dy = e.clientY - dragStartRef.current.my;

      // Only start dragging after a small threshold to distinguish from clicks
      if (!isDraggingRef.current && Math.abs(dx) + Math.abs(dy) < 3) return;
      isDraggingRef.current = true;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const transform = (canvas as any).__minimapTransform;
      if (!transform) return;

      // Convert minimap delta to world delta
      const worldDx = dx / transform.scale;
      const worldDy = dy / transform.scale;

      // Update drag start for continuous dragging
      dragStartRef.current = { mx: e.clientX, my: e.clientY };

      // Pan the main camera — move the viewport center
      const currentVp = camera?.getViewport();
      if (currentVp && camera) {
        camera.focusOn(
          currentVp.x + currentVp.width / 2 + worldDx,
          currentVp.y + currentVp.height / 2 + worldDy,
          false
        );
      }
    },
    [camera]
  );

  const handleMouseUp = useCallback(() => {
    // Small delay to prevent click from firing after drag
    setTimeout(() => { isDraggingRef.current = false; }, 50);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={MINIMAP_W}
      height={MINIMAP_H}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
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
