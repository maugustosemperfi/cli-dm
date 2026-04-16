import { Graphics } from "pixi.js";
import type { NodeStatus } from "../../protocol/events";
import { THEME, ROOM_WIDTH, ROOM_HEIGHT, AGENT_HEX } from "./theme";
import type { LayoutNode } from "./layout";
import type { RoomMetrics, MapLayer } from "../../stores/gameState";

/** Half-width of the corridor hallway in pixels */
const CORRIDOR_HALF_W = 18;
/** Number of sample points for the corridor spine */
const SPINE_STEPS = 24;

interface FlowParticle {
  t: number;       // 0-1 position along curve
  speed: number;
  color: number;
  alpha: number;
  size: number;
}

export class Corridor extends Graphics {
  fromNode: LayoutNode;
  toNode: LayoutNode;
  private dashOffset = 0;
  private flowParticles: FlowParticle[] = [];
  private fireParticles: Array<{ t: number; vy: number; life: number; x: number }> = [];
  private flowIntensity = 0;
  private fireIntensity = 0;
  private accumulatedHeat = 0;
  private burnPulse = 0;       // 0-1, normalized burn intensity for width pulse
  private bottleneckRatio = 0; // fraction of total tokens at this corridor's endpoint
  /** Precomputed spine points for the corridor curve */
  private spine: Array<[number, number]> = [];
  private overlayGfx: Graphics;

  constructor(from: LayoutNode, to: LayoutNode) {
    super();
    this.fromNode = from;
    this.toNode = to;
    this.overlayGfx = new Graphics();
    this.overlayGfx.alpha = 0;
    this.addChild(this.overlayGfx);
    this.computeSpine();
    this.draw(THEME.corridorDefault, false);
  }

  /** Get accumulated traffic heat (0-1) */
  get heat(): number { return this.accumulatedHeat; }

  /** Get spine point by index (0 to SPINE_STEPS) for torch placement */
  getSpinePoint(index: number): [number, number] | null {
    if (index < 0 || index >= this.spine.length) return null;
    return this.spine[index];
  }

  /** Get normal direction at spine index for torch offset */
  getNormal(index: number): [number, number] | null {
    if (index < 0 || index >= this.spine.length) return null;
    return this.normalAt(index);
  }

  update(fromStatus: NodeStatus, toStatus: NodeStatus, isBlocked: boolean) {
    let color: number = THEME.corridorDefault;

    if (isBlocked) {
      color = THEME.corridorBlocked;
    } else if (fromStatus === "completed" && toStatus === "completed") {
      color = THEME.corridorCompleted;
    } else if (
      fromStatus === "in_progress" ||
      toStatus === "in_progress"
    ) {
      color = THEME.corridorActive;
    }

    this.draw(color, isBlocked);
  }

  /** Add tool flow energy — particles travel along the corridor */
  addFlow(agentRole?: string) {
    this.flowIntensity = Math.min(1, this.flowIntensity + 0.3);
    this.accumulatedHeat = Math.min(1, this.accumulatedHeat + 0.02);
    const color = agentRole ? (AGENT_HEX[agentRole] ?? THEME.corridorActive) : THEME.corridorActive;
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      this.flowParticles.push({
        t: Math.random() * 0.2,
        speed: 0.008 + Math.random() * 0.006,
        color,
        alpha: 0.6 + Math.random() * 0.4,
        size: 2 + Math.random() * 2.5,
      });
    }
    if (this.flowParticles.length > 30) {
      this.flowParticles.splice(0, this.flowParticles.length - 30);
    }
  }

  /** Ignite fire on this corridor — error propagation */
  ignite(intensity: number) {
    this.fireIntensity = Math.max(this.fireIntensity, intensity);
    for (let i = 0; i < 6; i++) {
      this.fireParticles.push({
        t: Math.random(),
        vy: -(0.3 + Math.random() * 0.8),
        life: 0.8 + Math.random() * 0.5,
        x: (Math.random() - 0.5) * CORRIDOR_HALF_W,
      });
    }
    if (this.fireParticles.length > 40) {
      this.fireParticles.splice(0, this.fireParticles.length - 40);
    }
  }

  /** Set overlay tinting for the active map layer */
  setOverlay(layer: MapLayer, fromMetrics: RoomMetrics | null, toMetrics: RoomMetrics | null, maxTokens: number, maxErrors: number) {
    this.overlayGfx.clear();

    if (layer === "default" || (!fromMetrics && !toMetrics)) {
      this.overlayGfx.alpha = 0;
      return;
    }

    const fm = fromMetrics ?? { totalTokens: 0, totalCostUSD: 0, errorCount: 0, actionCount: 0, lastActionTs: 0, lastErrorTs: 0 };
    const tm = toMetrics ?? { totalTokens: 0, totalCostUSD: 0, errorCount: 0, actionCount: 0, lastActionTs: 0, lastErrorTs: 0 };

    if (this.spine.length < 2) {
      this.overlayGfx.alpha = 0;
      return;
    }

    switch (layer) {
      case "cost": {
        const avgTokens = (fm.totalTokens + tm.totalTokens) / 2;
        const ratio = maxTokens > 0 ? Math.min(1, avgTokens / maxTokens) : 0;
        if (ratio < 0.01) { this.overlayGfx.alpha = 0; return; }
        const color = corridorLerpHeatColor(ratio);
        this.overlayGfx.moveTo(this.spine[0][0], this.spine[0][1]);
        for (let i = 1; i <= SPINE_STEPS; i++) {
          this.overlayGfx.lineTo(this.spine[i][0], this.spine[i][1]);
        }
        this.overlayGfx.stroke({ color, width: CORRIDOR_HALF_W * 1.2, alpha: 0.25 });
        this.overlayGfx.alpha = 1;
        break;
      }
      case "errors": {
        const hasErrors = fm.errorCount > 0 || tm.errorCount > 0;
        if (!hasErrors) { this.overlayGfx.alpha = 0; return; }
        this.overlayGfx.moveTo(this.spine[0][0], this.spine[0][1]);
        for (let i = 1; i <= SPINE_STEPS; i++) {
          this.overlayGfx.lineTo(this.spine[i][0], this.spine[i][1]);
        }
        const maxE = Math.max(fm.errorCount, tm.errorCount);
        const ratio = maxErrors > 0 ? Math.min(1, maxE / maxErrors) : 0.5;
        this.overlayGfx.stroke({ color: 0xff4444, width: CORRIDOR_HALF_W * 0.8, alpha: 0.15 + ratio * 0.2 });
        this.overlayGfx.alpha = 1;
        break;
      }
      case "activity": {
        const now = Date.now();
        const recentTs = Math.max(fm.lastActionTs, tm.lastActionTs);
        if (recentTs === 0) { this.overlayGfx.alpha = 0; return; }
        const age = now - recentTs;
        const MAX_AGE = 120_000;
        const recency = Math.max(0.1, 1 - age / MAX_AGE);
        this.overlayGfx.moveTo(this.spine[0][0], this.spine[0][1]);
        for (let i = 1; i <= SPINE_STEPS; i++) {
          this.overlayGfx.lineTo(this.spine[i][0], this.spine[i][1]);
        }
        this.overlayGfx.stroke({ color: 0x5b8abf, width: CORRIDOR_HALF_W * 0.6, alpha: recency * 0.3 });
        this.overlayGfx.alpha = 1;
        break;
      }
      case "fog": {
        // Fog overlay handled primarily by FogOfWar.ts
        this.overlayGfx.alpha = 0;
        break;
      }
    }
  }

  tick(dt: number) {
    this.dashOffset += dt * 0.5;

    this.flowIntensity *= 0.995;
    this.fireIntensity *= 0.99;
    this.accumulatedHeat *= 0.9995;

    let needsRedraw = false;
    for (let i = this.flowParticles.length - 1; i >= 0; i--) {
      const p = this.flowParticles[i];
      p.t += p.speed * dt;
      p.alpha -= 0.003 * dt;
      if (p.t > 1 || p.alpha <= 0) {
        this.flowParticles.splice(i, 1);
      }
      needsRedraw = true;
    }

    for (let i = this.fireParticles.length - 1; i >= 0; i--) {
      const fp = this.fireParticles[i];
      fp.life -= dt * 0.02;
      fp.vy -= dt * 0.005;
      if (fp.life <= 0) {
        this.fireParticles.splice(i, 1);
      }
      needsRedraw = true;
    }

    if (needsRedraw && (this.flowParticles.length > 0 || this.fireParticles.length > 0)) {
      this.drawParticles();
    }
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------

  private computeSpine() {
    // Determine exit/entry points based on relative room positions.
    // Rooms are centered at (node.x, node.y) with size ROOM_WIDTH x ROOM_HEIGHT.
    const dx = this.toNode.x - this.fromNode.x;
    const dy = this.toNode.y - this.fromNode.y;
    const isMoreHorizontal = Math.abs(dx) > Math.abs(dy);

    let x1: number, y1: number, x2: number, y2: number;
    let cx1: number, cy1: number, cx2: number, cy2: number;

    if (isMoreHorizontal) {
      // Horizontal corridor: exit right side, enter left side
      const dir = dx > 0 ? 1 : -1;
      x1 = this.fromNode.x + dir * ROOM_WIDTH / 2;
      y1 = this.fromNode.y;
      x2 = this.toNode.x - dir * ROOM_WIDTH / 2;
      y2 = this.toNode.y;
      // Control points: extend horizontally, then curve to target's y
      const extent = Math.abs(x2 - x1) * 0.4;
      cx1 = x1 + dir * extent;
      cy1 = y1;
      cx2 = x2 - dir * extent;
      cy2 = y2;
    } else {
      // Vertical corridor: exit bottom/top, enter top/bottom
      const dir = dy > 0 ? 1 : -1;
      x1 = this.fromNode.x;
      y1 = this.fromNode.y + dir * ROOM_HEIGHT / 2;
      x2 = this.toNode.x;
      y2 = this.toNode.y - dir * ROOM_HEIGHT / 2;
      // Control points: extend vertically, then curve to target's x
      const extent = Math.abs(y2 - y1) * 0.4;
      cx1 = x1;
      cy1 = y1 + dir * extent;
      cx2 = x2;
      cy2 = y2 - dir * extent;
    }

    this.spine = [];
    for (let i = 0; i <= SPINE_STEPS; i++) {
      const t = i / SPINE_STEPS;
      const u = 1 - t;
      const px = u*u*u*x1 + 3*u*u*t*cx1 + 3*u*t*t*cx2 + t*t*t*x2;
      const py = u*u*u*y1 + 3*u*u*t*cy1 + 3*u*t*t*cy2 + t*t*t*y2;
      this.spine.push([px, py]);
    }
  }

  /** Get bezier point at t (0-1) along the corridor curve */
  private pointOnCurve(t: number): [number, number] {
    // Interpolate between precomputed spine points
    const idx = t * SPINE_STEPS;
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, SPINE_STEPS);
    const frac = idx - lo;
    const [ax, ay] = this.spine[lo];
    const [bx, by] = this.spine[hi];
    return [ax + (bx - ax) * frac, ay + (by - ay) * frac];
  }

  /** Get normal (perpendicular) direction at spine index */
  private normalAt(i: number): [number, number] {
    const prev = this.spine[Math.max(0, i - 1)];
    const next = this.spine[Math.min(SPINE_STEPS, i + 1)];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Perpendicular: rotate 90 degrees
    return [-dy / len, dx / len];
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------

  private drawParticles() {
    for (const p of this.flowParticles) {
      const [px, py] = this.pointOnCurve(p.t);
      this.circle(px, py, p.size).fill({ color: p.color, alpha: p.alpha });
      this.circle(px, py, p.size * 2).fill({ color: p.color, alpha: p.alpha * 0.15 });
    }

    for (const fp of this.fireParticles) {
      const [bx, by] = this.pointOnCurve(fp.t);
      const fx = bx + fp.x;
      const fy = by + fp.vy * (1 - fp.life) * 30;
      const fireColor = fp.life > 0.5 ? 0xbf6b5b : 0xbfa85b;
      this.circle(fx, fy, 2 + fp.life * 2).fill({ color: fireColor, alpha: fp.life * 0.8 });
    }
  }

  private draw(accentColor: number, blocked: boolean) {
    this.clear();

    if (this.spine.length < 2) return;

    // --- Corridor floor (wide filled path) ---
    // Build top and bottom edges by offsetting the spine by the normal
    const topEdge: Array<[number, number]> = [];
    const bottomEdge: Array<[number, number]> = [];

    for (let i = 0; i <= SPINE_STEPS; i++) {
      const [nx, ny] = this.normalAt(i);
      const [sx, sy] = this.spine[i];
      topEdge.push([sx + nx * CORRIDOR_HALF_W, sy + ny * CORRIDOR_HALF_W]);
      bottomEdge.push([sx - nx * CORRIDOR_HALF_W, sy - ny * CORRIDOR_HALF_W]);
    }

    // Floor fill — dark stone
    this.moveTo(topEdge[0][0], topEdge[0][1]);
    for (let i = 1; i < topEdge.length; i++) {
      this.lineTo(topEdge[i][0], topEdge[i][1]);
    }
    for (let i = bottomEdge.length - 1; i >= 0; i--) {
      this.lineTo(bottomEdge[i][0], bottomEdge[i][1]);
    }
    this.closePath();
    this.fill({ color: 0x252729, alpha: 0.9 });

    // --- Stone floor texture (scattered dots) ---
    for (let i = 1; i < SPINE_STEPS; i += 2) {
      const [sx, sy] = this.spine[i];
      const [nx, ny] = this.normalAt(i);
      // A few random pebble dots across the floor width
      for (let j = 0; j < 3; j++) {
        const spread = (Math.random() - 0.5) * CORRIDOR_HALF_W * 1.4;
        const px = sx + nx * spread + (Math.random() - 0.5) * 4;
        const py = sy + ny * spread + (Math.random() - 0.5) * 4;
        this.circle(px, py, 0.8 + Math.random() * 0.8)
          .fill({ color: 0x3f4147, alpha: 0.3 + Math.random() * 0.2 });
      }
    }

    // --- Wall edges (top and bottom borders) ---
    this.moveTo(topEdge[0][0], topEdge[0][1]);
    for (let i = 1; i < topEdge.length; i++) {
      this.lineTo(topEdge[i][0], topEdge[i][1]);
    }
    this.stroke({ color: THEME.roomStroke, width: 2, alpha: 0.7 });

    this.moveTo(bottomEdge[0][0], bottomEdge[0][1]);
    for (let i = 1; i < bottomEdge.length; i++) {
      this.lineTo(bottomEdge[i][0], bottomEdge[i][1]);
    }
    this.stroke({ color: THEME.roomStroke, width: 2, alpha: 0.7 });

    // --- Center line (faint guide path) ---
    this.moveTo(this.spine[0][0], this.spine[0][1]);
    for (let i = 1; i <= SPINE_STEPS; i++) {
      this.lineTo(this.spine[i][0], this.spine[i][1]);
    }
    this.stroke({ color: accentColor, width: 1, alpha: 0.25 });

    // --- Accent glow along center when active ---
    if (accentColor !== THEME.corridorDefault) {
      this.moveTo(this.spine[0][0], this.spine[0][1]);
      for (let i = 1; i <= SPINE_STEPS; i++) {
        this.lineTo(this.spine[i][0], this.spine[i][1]);
      }
      this.stroke({ color: accentColor, width: 6, alpha: 0.08 });
    }

    // --- Flow intensity glow ---
    if (this.flowIntensity > 0.05) {
      this.moveTo(this.spine[0][0], this.spine[0][1]);
      for (let i = 1; i <= SPINE_STEPS; i++) {
        this.lineTo(this.spine[i][0], this.spine[i][1]);
      }
      this.stroke({ color: THEME.corridorActive, width: CORRIDOR_HALF_W + this.flowIntensity * 8, alpha: this.flowIntensity * 0.15 });
    }

    // --- Fire glow ---
    if (this.fireIntensity > 0.05) {
      this.moveTo(this.spine[0][0], this.spine[0][1]);
      for (let i = 1; i <= SPINE_STEPS; i++) {
        this.lineTo(this.spine[i][0], this.spine[i][1]);
      }
      this.stroke({ color: 0xbf6b5b, width: CORRIDOR_HALF_W + this.fireIntensity * 6, alpha: this.fireIntensity * 0.2 });
    }

    // --- Corridor traffic heatmap ---
    if (this.accumulatedHeat > 0.02) {
      const heatColor = this.accumulatedHeat < 0.33 ? 0x5b8abf
        : this.accumulatedHeat < 0.66 ? 0xbfa85b : 0xbf6b5b;
      this.moveTo(this.spine[0][0], this.spine[0][1]);
      for (let i = 1; i <= SPINE_STEPS; i++) {
        this.lineTo(this.spine[i][0], this.spine[i][1]);
      }
      this.stroke({ color: heatColor, width: CORRIDOR_HALF_W * 0.8, alpha: this.accumulatedHeat * 0.12 });
    }

    // --- Blocked marker: X at midpoint ---
    if (blocked) {
      const [mx, my] = this.spine[Math.floor(SPINE_STEPS / 2)];
      const s = 10;
      this.moveTo(mx - s, my - s).lineTo(mx + s, my + s)
        .stroke({ color: THEME.corridorBlocked, width: 3 });
      this.moveTo(mx + s, my - s).lineTo(mx - s, my + s)
        .stroke({ color: THEME.corridorBlocked, width: 3 });
    }

    // --- Doorway arches at each end ---
    this.drawDoorway(this.spine[0], this.normalAt(0), accentColor);
    this.drawDoorway(this.spine[SPINE_STEPS], this.normalAt(SPINE_STEPS), accentColor);

    // --- Arrow head at destination end ---
    const last = this.spine[SPINE_STEPS];
    const prev = this.spine[SPINE_STEPS - 1];
    const adx = last[0] - prev[0];
    const ady = last[1] - prev[1];
    const alen = Math.sqrt(adx * adx + ady * ady) || 1;
    const ax = adx / alen;
    const ay = ady / alen;
    const arrowSize = 8;
    this.moveTo(last[0], last[1])
      .lineTo(last[0] - ax * arrowSize - ay * arrowSize, last[1] - ay * arrowSize + ax * arrowSize)
      .moveTo(last[0], last[1])
      .lineTo(last[0] - ax * arrowSize + ay * arrowSize, last[1] - ay * arrowSize - ax * arrowSize)
      .stroke({ color: accentColor, width: 2, alpha: 0.5 });

    // Draw active particles on top
    if (this.flowParticles.length > 0 || this.fireParticles.length > 0) {
      this.drawParticles();
    }
  }

  /** Draw a small doorway arch at a corridor endpoint */
  private drawDoorway(pos: [number, number], normal: [number, number], color: number) {
    const [px, py] = pos;
    const [nx, ny] = normal;
    const hw = CORRIDOR_HALF_W + 2;

    // Doorway posts (two small vertical lines)
    const topX = px + nx * hw;
    const topY = py + ny * hw;
    const botX = px - nx * hw;
    const botY = py - ny * hw;

    this.moveTo(topX - ny * 3, topY + nx * 3)
      .lineTo(topX + ny * 3, topY - nx * 3)
      .stroke({ color, width: 2.5, alpha: 0.5 });

    this.moveTo(botX - ny * 3, botY + nx * 3)
      .lineTo(botX + ny * 3, botY - nx * 3)
      .stroke({ color, width: 2.5, alpha: 0.5 });

    // Small arch across the top
    this.moveTo(topX, topY).lineTo(botX, botY)
      .stroke({ color, width: 1.5, alpha: 0.2 });
  }
}

/** Green → Yellow → Red heatmap color based on 0-1 ratio */
function corridorLerpHeatColor(ratio: number): number {
  const lerp = (a: number, b: number, t: number) => {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
    const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
    return (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t);
  };
  if (ratio < 0.5) return lerp(0x00ff00, 0xffff00, ratio * 2);
  return lerp(0xffff00, 0xff0000, (ratio - 0.5) * 2);
}
