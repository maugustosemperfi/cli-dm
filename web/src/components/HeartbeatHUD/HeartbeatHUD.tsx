import { useEffect, useRef } from "react";
import { useGameState, AGENT_COLORS } from "../../stores/gameState";

const WIDTH = 200;
const HEIGHT = 32;
const MAX_SAMPLES = 60; // ~1 minute at 1 sample/sec

export function HeartbeatHUD() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const samplesRef = useRef<Map<string, number[]>>(new Map());
  const agents = useGameState((s) => s.agents);

  // Sample agent activity every second
  useEffect(() => {
    const interval = setInterval(() => {
      const samples = samplesRef.current;
      for (const [id, agent] of agents) {
        if (!samples.has(id)) samples.set(id, []);
        const arr = samples.get(id)!;
        const isActive = agent.currentAction !== "idle" && !agent.isComplete;
        arr.push(isActive ? 1 : 0);
        if (arr.length > MAX_SAMPLES) arr.shift();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [agents]);

  // Draw heartbeat
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, WIDTH, HEIGHT);

      // Background
      ctx.fillStyle = "rgba(43, 45, 49, 0.85)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);

      // Draw each agent's heartbeat as a stacked line
      const agentIds = [...samplesRef.current.keys()];
      const lineHeight = Math.max(4, HEIGHT / Math.max(agentIds.length, 1));

      for (let i = 0; i < agentIds.length; i++) {
        const id = agentIds[i];
        const arr = samplesRef.current.get(id) ?? [];
        const agent = agents.get(id);
        const color = agent ? AGENT_COLORS[agent.role] ?? "#8b9aab" : "#8b9aab";
        const y = i * lineHeight + lineHeight / 2;

        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;

        for (let j = 0; j < arr.length; j++) {
          const x = (j / MAX_SAMPLES) * WIDTH;
          const val = arr[j];
          // EKG-style: active = spike, idle = flat
          const spike = val > 0 ? lineHeight * 0.4 : 0;
          const py = y - spike;
          if (j === 0) ctx.moveTo(x, py);
          else ctx.lineTo(x, py);
        }
        ctx.stroke();

        // Flat baseline
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 0.3;
        ctx.globalAlpha = 0.3;
        ctx.moveTo(0, y);
        ctx.lineTo(WIDTH, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      requestAnimationFrame(draw);
    };
    const raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [agents]);

  return (
    <canvas
      ref={canvasRef}
      width={WIDTH}
      height={HEIGHT}
      style={{
        position: "absolute",
        bottom: 8,
        right: 8,
        borderRadius: 4,
        border: "1px solid #3f4147",
        pointerEvents: "none",
        zIndex: 10,
      }}
    />
  );
}
