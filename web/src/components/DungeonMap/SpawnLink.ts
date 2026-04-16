import { Graphics } from "pixi.js";
import { AGENT_HEX } from "./theme";

export class SpawnLink extends Graphics {
  private fromX: number;
  private fromY: number;
  private toX: number;
  private toY: number;
  private time = 0;
  private color: number;

  constructor(fromX: number, fromY: number, toX: number, toY: number, role: string) {
    super();
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;
    this.color = AGENT_HEX[role] ?? 0x8b9aab;
    this.draw();
  }

  updatePositions(fromX: number, fromY: number, toX: number, toY: number) {
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;
  }

  tick(dt: number) {
    this.time += dt;
    this.draw();
  }

  private draw() {
    this.clear();
    // Draw a dashed bezier curve from parent to child
    // Use 24 steps along a bezier, draw alternating dash/gap segments
    // Animated dash offset = this.time * 0.03

    const steps = 24;
    const dashLen = 3; // draw 3 steps, skip 3 steps
    const offset = Math.floor(this.time * 0.03) % (dashLen * 2);

    // Bezier control point: midpoint shifted perpendicular
    const midX = (this.fromX + this.toX) / 2;
    const midY = (this.fromY + this.toY) / 2;
    // Perpendicular offset for curve
    const dx = this.toX - this.fromX;
    const dy = this.toY - this.fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const perpX = (-dy / (dist || 1)) * 20;
    const perpY = (dx / (dist || 1)) * 20;
    const cpX = midX + perpX;
    const cpY = midY + perpY;

    // Compute points along quadratic bezier
    const points: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const px = u * u * this.fromX + 2 * u * t * cpX + t * t * this.toX;
      const py = u * u * this.fromY + 2 * u * t * cpY + t * t * this.toY;
      points.push([px, py]);
    }

    // Draw dashed line with animated offset
    const pulse = 0.4 + Math.sin(this.time * 0.04) * 0.2;
    for (let i = 0; i < points.length - 1; i++) {
      const phase = (i + offset) % (dashLen * 2);
      if (phase < dashLen) {
        this.moveTo(points[i][0], points[i][1])
          .lineTo(points[i + 1][0], points[i + 1][1])
          .stroke({ color: this.color, width: 1.5, alpha: pulse });
      }
    }

    // Glow particles traveling along the path (3 particles)
    for (let p = 0; p < 3; p++) {
      const t = (this.time * 0.015 + p * 0.33) % 1;
      const idx = Math.floor(t * (points.length - 1));
      const [px, py] = points[Math.min(idx, points.length - 1)];
      this.circle(px, py, 2).fill({ color: this.color, alpha: 0.6 });
      this.circle(px, py, 5).fill({ color: this.color, alpha: 0.15 });
    }
  }
}
