import { useRef, useEffect } from "react";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";

const ACTION_COLORS: Record<string, string> = {
  read: "#5b8abf",
  edit: "#8b6baf",
  test: "#bf6b5b",
  build: "#bfa85b",
  git: "#5baf7b",
  shell: "#6d6f78",
  network: "#8b6baf",
  thinking: "#4e5058",
  idle: "#3f4147",
  blocked: "#bf6b5b",
  error: "#bf6b5b",
};

const LANE_HEIGHT = 28;
const HEADER_WIDTH = 100;
const MIN_BLOCK_WIDTH = 4;
const PIXELS_PER_SECOND = 8;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function Timeline() {
  const timeline = useGameState((s) => s.timeline);
  const agents = useGameState((s) => s.agents);
  const selectedAgent = useGameState((s) => s.selectedAgent);
  const selectAgent = useGameState((s) => s.selectAgent);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolledRef = useRef(true);

  // Group segments by agent
  const agentIds = [...new Set(timeline.map((s) => s.agentId))];

  // Auto-scroll to right (latest time)
  useEffect(() => {
    const el = containerRef.current;
    if (el && isScrolledRef.current) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [timeline]);

  // Canvas rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || timeline.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = Date.now();
    const startTime = timeline.length > 0 ? timeline[0].startTs : now;
    const endTime = now;
    const duration = endTime - startTime;
    const totalWidth = Math.max(HEADER_WIDTH + 200, HEADER_WIDTH + (duration / 1000) * PIXELS_PER_SECOND);
    const totalHeight = agentIds.length * LANE_HEIGHT + 20;

    canvas.width = totalWidth * window.devicePixelRatio;
    canvas.height = totalHeight * window.devicePixelRatio;
    canvas.style.width = `${totalWidth}px`;
    canvas.style.height = `${totalHeight}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    // Clear
    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // Draw lane backgrounds and agent names
    for (let i = 0; i < agentIds.length; i++) {
      const y = i * LANE_HEIGHT;
      const agentId = agentIds[i];
      const agent = agents.get(agentId);
      const isSelected = selectedAgent === agentId;

      // Lane background
      ctx.fillStyle = isSelected ? "#3f4147" : i % 2 === 0 ? "#2b2d31" : "#313338";
      ctx.fillRect(0, y, totalWidth, LANE_HEIGHT);

      // Lane separator
      ctx.strokeStyle = "#3f4147";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(HEADER_WIDTH, y + LANE_HEIGHT);
      ctx.lineTo(totalWidth, y + LANE_HEIGHT);
      ctx.stroke();

      // Agent name
      const color = agent?.role ? AGENT_COLORS[agent.role] ?? "#8b9aab" : "#8b9aab";
      ctx.fillStyle = color;
      ctx.font = "bold 10px monospace";
      ctx.textBaseline = "middle";
      ctx.fillText(
        (agent?.name ?? agentId).slice(0, 12),
        4,
        y + LANE_HEIGHT / 2,
      );
    }

    // Header separator
    ctx.strokeStyle = "#3f4147";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HEADER_WIDTH, 0);
    ctx.lineTo(HEADER_WIDTH, totalHeight);
    ctx.stroke();

    // Time markers
    const timeStep = Math.max(10, Math.ceil(duration / 1000 / 20) * 5); // every N seconds
    ctx.fillStyle = "#6d6f78";
    ctx.font = "9px monospace";
    ctx.textBaseline = "top";
    for (let t = 0; t <= duration / 1000; t += timeStep) {
      const x = HEADER_WIDTH + t * PIXELS_PER_SECOND;
      ctx.strokeStyle = "#3f4147";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, totalHeight);
      ctx.stroke();
      ctx.fillText(`${t}s`, x + 2, totalHeight - 14);
    }

    // Draw segments
    for (const seg of timeline) {
      const laneIdx = agentIds.indexOf(seg.agentId);
      if (laneIdx < 0) continue;

      const y = laneIdx * LANE_HEIGHT + 3;
      const h = LANE_HEIGHT - 6;
      const xStart = HEADER_WIDTH + ((seg.startTs - startTime) / 1000) * PIXELS_PER_SECOND;
      const xEnd = seg.endTs
        ? HEADER_WIDTH + ((seg.endTs - startTime) / 1000) * PIXELS_PER_SECOND
        : HEADER_WIDTH + ((now - startTime) / 1000) * PIXELS_PER_SECOND;
      const w = Math.max(MIN_BLOCK_WIDTH, xEnd - xStart);

      // Block fill
      ctx.fillStyle = ACTION_COLORS[seg.action] ?? "#4e5058";
      ctx.globalAlpha = seg.endTs ? 0.8 : 0.6;
      ctx.beginPath();
      ctx.roundRect(xStart, y, w, h, 3);
      ctx.fill();

      // Active segment pulse border
      if (!seg.endTs) {
        ctx.strokeStyle = ACTION_COLORS[seg.action] ?? "#5b8abf";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.5 + Math.sin(Date.now() * 0.005) * 0.3;
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // Label inside block if wide enough
      if (w > 30) {
        ctx.fillStyle = "#dbdee1";
        ctx.font = "9px monospace";
        ctx.textBaseline = "middle";
        const label = seg.action + (seg.detail ? `: ${seg.detail.slice(0, 20)}` : "");
        ctx.fillText(label, xStart + 3, y + h / 2, w - 6);
      }
    }

    // Current time marker
    const nowX = HEADER_WIDTH + ((now - startTime) / 1000) * PIXELS_PER_SECOND;
    ctx.strokeStyle = "#dbdee1";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(nowX, 0);
    ctx.lineTo(nowX, totalHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }, [timeline, agents, agentIds, selectedAgent]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const nearRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 30;
    isScrolledRef.current = nearRight;
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const laneIdx = Math.floor(y / LANE_HEIGHT);
    if (laneIdx >= 0 && laneIdx < agentIds.length) {
      selectAgent(agentIds[laneIdx]);
    }
  };

  // Tooltip state
  const getTooltip = (e: React.MouseEvent<HTMLCanvasElement>): string => {
    const canvas = canvasRef.current;
    if (!canvas || timeline.length === 0) return "";
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const laneIdx = Math.floor(y / LANE_HEIGHT);
    if (laneIdx < 0 || laneIdx >= agentIds.length) return "";

    const startTime = timeline[0].startTs;
    const now = Date.now();
    const agentId = agentIds[laneIdx];

    for (const seg of timeline) {
      if (seg.agentId !== agentId) continue;
      const xStart = HEADER_WIDTH + ((seg.startTs - startTime) / 1000) * PIXELS_PER_SECOND;
      const xEnd = seg.endTs
        ? HEADER_WIDTH + ((seg.endTs - startTime) / 1000) * PIXELS_PER_SECOND
        : HEADER_WIDTH + ((now - startTime) / 1000) * PIXELS_PER_SECOND;
      if (x >= xStart && x <= xEnd) {
        const dur = (seg.endTs ?? now) - seg.startTs;
        return `${seg.action}${seg.detail ? ": " + seg.detail : ""} (${formatDuration(dur)})`;
      }
    }
    return "";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          padding: "6px 8px",
          fontFamily: "monospace",
          fontSize: 12,
          color: "#8b9aab",
          borderBottom: "1px solid #3f4147",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>Concurrency Timeline</span>
        <span style={{ color: "#6d6f78" }}>{agentIds.length} agents</span>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowX: "auto", overflowY: "auto" }}
      >
        {timeline.length === 0 ? (
          <div style={{ color: "#6d6f78", padding: 20, textAlign: "center", fontFamily: "monospace", fontSize: 12 }}>
            Waiting for agent activity...
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={(e) => {
              const tip = getTooltip(e);
              if (canvasRef.current) canvasRef.current.title = tip;
            }}
            style={{ cursor: "pointer", display: "block" }}
          />
        )}
      </div>
    </div>
  );
}
