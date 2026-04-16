import { useRef, useEffect, useCallback, useState } from "react";
import { useWorldState, type SessionWing } from "../../stores/worldState";

/**
 * WorldMap — shows all past sessions as connected dungeon wings.
 *
 * Completed sessions are rendered as "ancient ruins" (desaturated, crumbling).
 * The current session glows brightly.
 * Click a past session to view its summary.
 */

const WING_SIZE = 60;
const COLORS = {
  bg: "#1a1a2e",
  ruins: "#4a4a5a",
  ruinsFill: "#2a2a3a",
  current: "#5b8abf",
  currentFill: "#2b3d5a",
  completed: "#3a5a3a",
  failed: "#5a3a3a",
  corridor: "#333344",
  text: "#8b9aab",
  textBright: "#dbdee1",
  highlight: "#5b8abf",
};

export function WorldMap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessions = useWorldState((s) => s.sessions);
  const currentSessionId = useWorldState((s) => s.currentSessionId);
  const showWorldMap = useWorldState((s) => s.showWorldMap);
  const toggleWorldMap = useWorldState((s) => s.toggleWorldMap);
  const [selected, setSelected] = useState<SessionWing | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; offX: number; offY: number } | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2 + offset.x;
    const cy = h / 2 + offset.y;

    // Clear
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // Draw corridors connecting sessions to center
    ctx.strokeStyle = COLORS.corridor;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    for (const session of sessions) {
      const sx = cx + session.worldX;
      const sy = cy + session.worldY;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(sx, sy);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Draw center hub
    ctx.fillStyle = COLORS.current;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();

    // Draw session wings
    for (const session of sessions) {
      const sx = cx + session.worldX;
      const sy = cy + session.worldY;
      const isCurrent = session.sessionId === currentSessionId;
      const isSelected = selected?.sessionId === session.sessionId;

      // Wing building (dungeon outline)
      const size = WING_SIZE * (isCurrent ? 1.2 : 0.8 + Math.min(session.agentCount / 10, 0.4));

      ctx.save();
      ctx.translate(sx, sy);

      // Fill
      ctx.fillStyle = isCurrent
        ? COLORS.currentFill
        : session.status === "failed"
          ? COLORS.failed
          : COLORS.ruinsFill;
      ctx.fillRect(-size / 2, -size / 2, size, size);

      // Border
      ctx.strokeStyle = isCurrent
        ? COLORS.current
        : isSelected
          ? COLORS.highlight
          : COLORS.ruins;
      ctx.lineWidth = isCurrent ? 2 : 1;
      ctx.strokeRect(-size / 2, -size / 2, size, size);

      // Crenellations for completed sessions (ruins)
      if (!isCurrent && session.status === "completed") {
        ctx.fillStyle = COLORS.ruins;
        const crenW = size / 6;
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(-size / 2 + i * crenW * 2, -size / 2 - 4, crenW, 4);
        }
        // Crumble effect — random gaps
        ctx.fillStyle = COLORS.bg;
        const hash = session.sessionId.split("").reduce((h, c) => h * 31 + c.charCodeAt(0), 0);
        for (let i = 0; i < 3; i++) {
          const gx = ((hash >> (i * 8)) & 0xff) % Math.floor(size);
          const gy = ((hash >> (i * 4)) & 0xff) % Math.floor(size);
          ctx.fillRect(-size / 2 + gx, -size / 2 + gy, 4, 4);
        }
      }

      // Agent count dots
      const dotCount = Math.min(session.agentCount, 6);
      for (let i = 0; i < dotCount; i++) {
        const angle = (Math.PI * 2 * i) / dotCount;
        const dx = Math.cos(angle) * (size / 4);
        const dy = Math.sin(angle) * (size / 4);
        ctx.fillStyle = isCurrent ? COLORS.textBright : COLORS.text;
        ctx.beginPath();
        ctx.arc(dx, dy, 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Label
      ctx.fillStyle = isCurrent ? COLORS.textBright : COLORS.text;
      ctx.font = "10px monospace";
      ctx.textAlign = "center";
      const label = session.name.length > 15 ? session.name.slice(0, 15) + "..." : session.name;
      ctx.fillText(label, sx, sy + size / 2 + 14);

      // Current session glow
      if (isCurrent) {
        ctx.save();
        ctx.globalAlpha = 0.15 + 0.05 * Math.sin(Date.now() / 500);
        ctx.fillStyle = COLORS.current;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // Title
    ctx.fillStyle = COLORS.textBright;
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "left";
    ctx.fillText("WORLD MAP", 16, 28);
    ctx.font = "10px monospace";
    ctx.fillStyle = COLORS.text;
    ctx.fillText(`${sessions.length} session${sessions.length !== 1 ? "s" : ""} recorded`, 16, 44);
  }, [sessions, currentSessionId, selected, offset]);

  // Animation loop
  useEffect(() => {
    if (!showWorldMap) return;
    let animId: number;
    const loop = () => {
      draw();
      animId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animId);
  }, [showWorldMap, draw]);

  // Resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.parentElement?.clientWidth ?? 600;
      canvas.height = canvas.parentElement?.clientHeight ?? 400;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [showWorldMap]);

  // Click to select session
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cx = canvas.width / 2 + offset.x;
      const cy = canvas.height / 2 + offset.y;

      for (const session of sessions) {
        const sx = cx + session.worldX;
        const sy = cy + session.worldY;
        const dist = Math.sqrt((mx - sx) ** 2 + (my - sy) ** 2);
        if (dist < WING_SIZE) {
          setSelected(session);
          return;
        }
      }
      setSelected(null);
    },
    [sessions, offset]
  );

  // Drag to pan
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragRef.current = { startX: e.clientX, startY: e.clientY, offX: offset.x, offY: offset.y };
    },
    [offset]
  );
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setOffset({
      x: dragRef.current.offX + (e.clientX - dragRef.current.startX),
      y: dragRef.current.offY + (e.clientY - dragRef.current.startY),
    });
  }, []);
  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  if (!showWorldMap) {
    return (
      <button
        onClick={toggleWorldMap}
        style={{
          position: "fixed",
          bottom: 48,
          left: 12,
          zIndex: 100,
          background: "#1e1f22",
          color: "#8b9aab",
          border: "1px solid #3f4147",
          borderRadius: 4,
          padding: "4px 10px",
          fontSize: 11,
          fontFamily: "monospace",
          cursor: "pointer",
        }}
      >
        World Map
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Close bar */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: 8 }}>
        <button
          onClick={toggleWorldMap}
          style={{
            background: "#2b2d31",
            color: "#dbdee1",
            border: "1px solid #3f4147",
            borderRadius: 4,
            padding: "4px 12px",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: 12,
          }}
        >
          Close
        </button>
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: "relative" }}>
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ width: "100%", height: "100%", cursor: dragRef.current ? "grabbing" : "grab" }}
        />

        {/* Selected session details */}
        {selected && (
          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: 16,
              background: "#1e1f22",
              border: "1px solid #3f4147",
              borderRadius: 6,
              padding: 16,
              maxWidth: 300,
              fontFamily: "monospace",
              fontSize: 12,
            }}
          >
            <div style={{ color: "#5b8abf", fontWeight: "bold", marginBottom: 8 }}>
              {selected.name}
            </div>
            <div style={{ color: "#8b9aab" }}>
              <div>Status: {selected.status}</div>
              <div>Agents: {selected.agentCount} | Tasks: {selected.taskCount}</div>
              <div>XP: {selected.totalXP} | Tokens: {selected.totalTokens.toLocaleString()}</div>
              <div>
                {new Date(selected.startedAt).toLocaleDateString()} {" "}
                {selected.endedAt
                  ? `(${Math.round((selected.endedAt - selected.startedAt) / 60000)}min)`
                  : "(running)"}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
