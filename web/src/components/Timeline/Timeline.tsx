import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";
import type { TimelineSegment } from "../../stores/gameState";

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
const TIME_AXIS_HEIGHT = 16;
const ZOOM_LEVELS = [2, 4, 8, 16, 32];

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

interface TooltipState {
  text: string;
  x: number;
  y: number;
}

export function Timeline({ onClose }: { onClose?: () => void }) {
  const timeline = useGameState((s) => s.timeline);
  const agents = useGameState((s) => s.agents);
  const selectedAgent = useGameState((s) => s.selectedAgent);
  const selectAgent = useGameState((s) => s.selectAgent);
  const searchQuery = useGameState((s) => s.searchQuery);
  const searchFilters = useGameState((s) => s.searchFilters);
  const getFilteredTimeline = useGameState((s) => s.getFilteredTimeline);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrolledRef = useRef(true);
  const animFrameRef = useRef<number | null>(null);
  const scrollLeftRef = useRef(0);
  const viewportWidthRef = useRef(800);

  const [zoomIndex, setZoomIndex] = useState(2); // default index 2 = value 8
  const pixelsPerSecond = ZOOM_LEVELS[zoomIndex];

  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  // Group segments by agent
  const agentIds = useMemo(
    () => [...new Set(timeline.map((s) => s.agentId))],
    [timeline]
  );

  // Auto-scroll to right (latest time)
  useEffect(() => {
    const el = containerRef.current;
    if (el && isScrolledRef.current) {
      el.scrollLeft = el.scrollWidth;
    }
  }, [timeline, pixelsPerSecond]);

  // Build set of matched timeline segments for search highlighting
  const hasActiveSearch = searchQuery.trim() !== "" ||
    searchFilters.agentIds.length > 0 ||
    searchFilters.actionTypes.length > 0 ||
    searchFilters.timeRange !== "all";

  const matchedSegments = useMemo(() => {
    if (!hasActiveSearch) return null;
    const filtered = getFilteredTimeline();
    return new Set(filtered.map((s: TimelineSegment) => `${s.agentId}-${s.startTs}`));
  }, [hasActiveSearch, getFilteredTimeline, timeline, searchQuery, searchFilters]);

  // Canvas rendering (wrapped in a draw function for animation loop)
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || timeline.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = Date.now();
    const startTime = timeline.length > 0 ? timeline[0].startTs : now;
    const endTime = now;
    const duration = endTime - startTime;
    const totalWidth = Math.max(
      HEADER_WIDTH + 200,
      HEADER_WIDTH + (duration / 1000) * pixelsPerSecond
    );
    const lanesHeight = agentIds.length * LANE_HEIGHT;
    const totalHeight = lanesHeight + TIME_AXIS_HEIGHT;

    // Only resize if needed to avoid flicker
    const dpr = window.devicePixelRatio;
    if (
      canvas.width !== Math.round(totalWidth * dpr) ||
      canvas.height !== Math.round(totalHeight * dpr)
    ) {
      canvas.width = Math.round(totalWidth * dpr);
      canvas.height = Math.round(totalHeight * dpr);
      canvas.style.width = `${totalWidth}px`;
      canvas.style.height = `${totalHeight}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = "#2b2d31";
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // Time axis background strip
    ctx.fillStyle = "#23252a";
    ctx.fillRect(HEADER_WIDTH, 0, totalWidth - HEADER_WIDTH, TIME_AXIS_HEIGHT);

    // Time markers
    const timeStep = Math.max(10, Math.ceil(duration / 1000 / 20) * 5);
    ctx.fillStyle = "#6d6f78";
    ctx.font = "9px monospace";
    ctx.textBaseline = "top";
    for (let t = 0; t <= duration / 1000; t += timeStep) {
      const x = HEADER_WIDTH + t * pixelsPerSecond;
      ctx.strokeStyle = "#3f4147";
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, TIME_AXIS_HEIGHT);
      ctx.lineTo(x, totalHeight);
      ctx.stroke();
      // Tick mark on time axis
      ctx.strokeStyle = "#4e5058";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, TIME_AXIS_HEIGHT - 4);
      ctx.lineTo(x, TIME_AXIS_HEIGHT);
      ctx.stroke();
      // Label in top axis area
      ctx.fillText(`${t}s`, x + 2, 4);
    }

    // Bottom border of time axis
    ctx.strokeStyle = "#3f4147";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, TIME_AXIS_HEIGHT);
    ctx.lineTo(totalWidth, TIME_AXIS_HEIGHT);
    ctx.stroke();

    // Draw lane backgrounds and agent names
    for (let i = 0; i < agentIds.length; i++) {
      const y = TIME_AXIS_HEIGHT + i * LANE_HEIGHT;
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
        y + LANE_HEIGHT / 2
      );
    }

    // Header separator (vertical line after agent names)
    ctx.strokeStyle = "#3f4147";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(HEADER_WIDTH, 0);
    ctx.lineTo(HEADER_WIDTH, totalHeight);
    ctx.stroke();

    // Draw segments (viewport-culled)
    const viewScroll = scrollLeftRef.current;
    const viewWidth = viewportWidthRef.current;
    const visibleXMin = viewScroll - 80;
    const visibleXMax = viewScroll + viewWidth + 80;

    for (const seg of timeline) {
      const laneIdx = agentIds.indexOf(seg.agentId);
      if (laneIdx < 0) continue;

      const xStart =
        HEADER_WIDTH + ((seg.startTs - startTime) / 1000) * pixelsPerSecond;
      const xEnd = seg.endTs
        ? HEADER_WIDTH + ((seg.endTs - startTime) / 1000) * pixelsPerSecond
        : HEADER_WIDTH + ((now - startTime) / 1000) * pixelsPerSecond;
      const segRight = Math.max(xEnd, xStart + MIN_BLOCK_WIDTH);
      if (segRight < visibleXMin || xStart > visibleXMax) continue;

      // Search-aware dimming
      const segKey = `${seg.agentId}-${seg.startTs}`;
      const isSearchMatch = matchedSegments ? matchedSegments.has(segKey) : true;
      const dimFactor = matchedSegments && !isSearchMatch ? 0.25 : 1.0;

      const y = TIME_AXIS_HEIGHT + laneIdx * LANE_HEIGHT + 3;
      const h = LANE_HEIGHT - 6;
      const w = Math.max(MIN_BLOCK_WIDTH, xEnd - xStart);

      const baseColor = ACTION_COLORS[seg.action] ?? "#4e5058";

      // Block fill
      ctx.fillStyle = baseColor;
      ctx.globalAlpha = (seg.endTs ? 0.8 : 0.6) * dimFactor;
      ctx.beginPath();
      ctx.roundRect(xStart, y, w, h, 3);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Barber-pole animation for running segments
      if (!seg.endTs) {
        ctx.save();
        // Clip to the segment rect
        ctx.beginPath();
        ctx.roundRect(xStart, y, w, h, 3);
        ctx.clip();

        const stripeSpacing = 12;
        const stripeWidth = 5;
        const offset = (now * 0.02) % stripeSpacing;
        ctx.strokeStyle = "rgba(255,255,255,0.15)";
        ctx.lineWidth = stripeWidth;
        // Draw diagonal stripes across the segment
        const extra = h + stripeSpacing;
        for (let sx = xStart - extra + offset; sx < xStart + w + extra; sx += stripeSpacing) {
          ctx.beginPath();
          ctx.moveTo(sx, y);
          ctx.lineTo(sx + h, y + h);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Border: running segments get animated alpha border, completed get a 1px lighter border
      ctx.beginPath();
      ctx.roundRect(xStart, y, w, h, 3);
      if (matchedSegments && isSearchMatch) {
        // Bright border for search matches
        ctx.strokeStyle = "#bfa85b";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 1;
      } else if (!seg.endTs) {
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = (0.5 + Math.sin(now * 0.005) * 0.3) * dimFactor;
      } else {
        ctx.strokeStyle = lightenColor(baseColor, 0.4);
        ctx.lineWidth = 1;
        ctx.globalAlpha = 0.5 * dimFactor;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Label inside block if wide enough
      if (w > 30) {
        ctx.fillStyle = "#dbdee1";
        ctx.globalAlpha = dimFactor;
        ctx.font = "9px monospace";
        ctx.textBaseline = "middle";
        const label =
          seg.action + (seg.detail ? `: ${seg.detail.slice(0, 20)}` : "");
        ctx.fillText(label, xStart + 3, y + h / 2, w - 6);
        ctx.globalAlpha = 1;
      }
    }

    // Current time marker
    const nowX =
      HEADER_WIDTH + ((now - startTime) / 1000) * pixelsPerSecond;
    ctx.strokeStyle = "#dbdee1";
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(nowX, TIME_AXIS_HEIGHT);
    ctx.lineTo(nowX, totalHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }, [timeline, agents, agentIds, selectedAgent, pixelsPerSecond, matchedSegments]);

  // Animation loop: keeps running segments and barber-pole animated
  useEffect(() => {
    const hasRunning = timeline.some((s) => !s.endTs);

    const loop = () => {
      draw();
      if (hasRunning) {
        animFrameRef.current = requestAnimationFrame(loop);
      }
    };

    // Always draw at least once
    draw();
    if (hasRunning) {
      animFrameRef.current = requestAnimationFrame(loop);
    }

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [draw, timeline]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    scrollLeftRef.current = el.scrollLeft;
    viewportWidthRef.current = el.clientWidth;
    const nearRight = el.scrollLeft + el.clientWidth >= el.scrollWidth - 30;
    isScrolledRef.current = nearRight;
    draw();
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    viewportWidthRef.current = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        viewportWidthRef.current = containerRef.current.clientWidth;
        draw();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const adjustedY = y - TIME_AXIS_HEIGHT;
    const laneIdx = Math.floor(adjustedY / LANE_HEIGHT);
    if (laneIdx >= 0 && laneIdx < agentIds.length) {
      selectAgent(agentIds[laneIdx]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || timeline.length === 0) {
      setTooltip(null);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const adjustedY = y - TIME_AXIS_HEIGHT;
    const laneIdx = Math.floor(adjustedY / LANE_HEIGHT);

    if (laneIdx < 0 || laneIdx >= agentIds.length) {
      setTooltip(null);
      return;
    }

    const startTime = timeline[0].startTs;
    const now = Date.now();
    const agentId = agentIds[laneIdx];

    const viewScroll = scrollLeftRef.current;
    const viewWidth = viewportWidthRef.current;
    const visibleXMin = viewScroll - 80;
    const visibleXMax = viewScroll + viewWidth + 80;

    for (const seg of timeline) {
      if (seg.agentId !== agentId) continue;
      const xStart =
        HEADER_WIDTH + ((seg.startTs - startTime) / 1000) * pixelsPerSecond;
      const xEnd = seg.endTs
        ? HEADER_WIDTH + ((seg.endTs - startTime) / 1000) * pixelsPerSecond
        : HEADER_WIDTH + ((now - startTime) / 1000) * pixelsPerSecond;
      const segRight = Math.max(xEnd, xStart + MIN_BLOCK_WIDTH);
      if (segRight < visibleXMin || xStart > visibleXMax) continue;
      if (x >= xStart && x <= segRight) {
        const dur = (seg.endTs ?? now) - seg.startTs;
        const text = `${seg.action}${seg.detail ? ": " + seg.detail : ""} (${formatDuration(dur)})`;
        // Position tooltip relative to the container div, not the canvas
        const containerRect = containerRef.current?.getBoundingClientRect();
        const tipX = containerRect
          ? e.clientX - containerRect.left + 12
          : e.clientX + 12;
        const tipY = containerRect
          ? e.clientY - containerRect.top - 8
          : e.clientY - 8;
        setTooltip({ text, x: tipX, y: tipY });
        return;
      }
    }
    setTooltip(null);
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  const zoomIn = () => setZoomIndex((i) => Math.min(i + 1, ZOOM_LEVELS.length - 1));
  const zoomOut = () => setZoomIndex((i) => Math.max(i - 1, 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "6px 8px",
          fontFamily: "monospace",
          fontSize: 12,
          color: "#8b9aab",
          borderBottom: "1px solid #3f4147",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <span>Concurrency Timeline</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {onClose && (
            <button
              onClick={onClose}
              title="Deactivate timeline"
              style={{
                background: "none",
                border: "1px solid #3f4147",
                borderRadius: 3,
                color: "#6d6f78",
                cursor: "pointer",
                fontFamily: "monospace",
                fontSize: 11,
                padding: "1px 6px",
              }}
            >
              ×
            </button>
          )}
          <span style={{ color: "#6d6f78" }}>{agentIds.length} agents</span>
          <div style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: 8 }}>
            <button
              onClick={zoomOut}
              disabled={zoomIndex === 0}
              title="Zoom out"
              style={{
                background: "none",
                border: "1px solid #3f4147",
                borderRadius: 3,
                color: zoomIndex === 0 ? "#4e5058" : "#dbdee1",
                cursor: zoomIndex === 0 ? "not-allowed" : "pointer",
                fontFamily: "monospace",
                fontSize: 13,
                lineHeight: 1,
                padding: "1px 6px",
                userSelect: "none",
              }}
            >
              -
            </button>
            <span
              style={{
                color: "#5b8abf",
                minWidth: 28,
                textAlign: "center",
                fontSize: 11,
              }}
            >
              {pixelsPerSecond}x
            </span>
            <button
              onClick={zoomIn}
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              title="Zoom in"
              style={{
                background: "none",
                border: "1px solid #3f4147",
                borderRadius: 3,
                color: zoomIndex === ZOOM_LEVELS.length - 1 ? "#4e5058" : "#dbdee1",
                cursor: zoomIndex === ZOOM_LEVELS.length - 1 ? "not-allowed" : "pointer",
                fontFamily: "monospace",
                fontSize: 13,
                lineHeight: 1,
                padding: "1px 6px",
                userSelect: "none",
              }}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable canvas area with tooltip overlay */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{ flex: 1, overflowX: "auto", overflowY: "auto", position: "relative" }}
      >
        {timeline.length === 0 ? (
          <div
            style={{
              color: "#6d6f78",
              padding: 20,
              textAlign: "center",
              fontFamily: "monospace",
              fontSize: 12,
            }}
          >
            Waiting for agent activity...
          </div>
        ) : (
          <>
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: "pointer", display: "block" }}
            />
            {tooltip && (
              <div
                style={{
                  position: "absolute",
                  left: tooltip.x,
                  top: tooltip.y,
                  background: "#1e2024",
                  border: "1px solid #3f4147",
                  borderRadius: 4,
                  padding: "4px 8px",
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "#dbdee1",
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                  zIndex: 10,
                  boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
                  maxWidth: 320,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {tooltip.text}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Lighten a hex color by mixing with white at the given ratio (0-1)
function lightenColor(hex: string, ratio: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * ratio);
  const lg = Math.round(g + (255 - g) * ratio);
  const lb = Math.round(b + (255 - b) * ratio);
  return `rgb(${lr},${lg},${lb})`;
}
