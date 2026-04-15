import { Container, Graphics } from "pixi.js";

export type CreatureType = "slime" | "bat" | "rat";

const P = 2; // pixel scale: each "pixel" is 2x2 screen pixels

// --- Slime frames (8x8) ---
const SLIME_FRAME_0: Array<[number, number, number]> = [
  // body
  [2, 3, 0x5baf7b], [3, 3, 0x5baf7b], [4, 3, 0x5baf7b], [5, 3, 0x5baf7b],
  [1, 4, 0x5baf7b], [2, 4, 0x4a9e6a], [3, 4, 0x4a9e6a], [4, 4, 0x4a9e6a], [5, 4, 0x4a9e6a], [6, 4, 0x5baf7b],
  [1, 5, 0x5baf7b], [2, 5, 0x4a9e6a], [3, 5, 0x5baf7b], [4, 5, 0x5baf7b], [5, 5, 0x4a9e6a], [6, 5, 0x5baf7b],
  [1, 6, 0x5baf7b], [2, 6, 0x5baf7b], [3, 6, 0x5baf7b], [4, 6, 0x5baf7b], [5, 6, 0x5baf7b], [6, 6, 0x5baf7b],
  [2, 7, 0x5baf7b], [3, 7, 0x5baf7b], [4, 7, 0x5baf7b], [5, 7, 0x5baf7b],
  // eyes
  [3, 4, 0xffffff], [5, 4, 0xffffff],
  [3, 5, 0x222222], [5, 5, 0x222222],
];

const SLIME_FRAME_1: Array<[number, number, number]> = [
  // squished body (wider, shorter)
  [1, 5, 0x5baf7b], [2, 5, 0x5baf7b], [3, 5, 0x5baf7b], [4, 5, 0x5baf7b], [5, 5, 0x5baf7b], [6, 5, 0x5baf7b],
  [0, 6, 0x5baf7b], [1, 6, 0x4a9e6a], [2, 6, 0x4a9e6a], [3, 6, 0x5baf7b], [4, 6, 0x5baf7b], [5, 6, 0x4a9e6a], [6, 6, 0x4a9e6a], [7, 6, 0x5baf7b],
  [0, 7, 0x5baf7b], [1, 7, 0x5baf7b], [2, 7, 0x5baf7b], [3, 7, 0x5baf7b], [4, 7, 0x5baf7b], [5, 7, 0x5baf7b], [6, 7, 0x5baf7b], [7, 7, 0x5baf7b],
  // eyes
  [2, 5, 0xffffff], [5, 5, 0xffffff],
  [2, 6, 0x222222], [5, 6, 0x222222],
];

// --- Bat frames (8x8) ---
const BAT_FRAME_0: Array<[number, number, number]> = [
  // wings up
  [0, 1, 0x6b4f8b], [7, 1, 0x6b4f8b],
  [0, 2, 0x6b4f8b], [1, 2, 0x6b4f8b], [6, 2, 0x6b4f8b], [7, 2, 0x6b4f8b],
  [1, 3, 0x6b4f8b], [2, 3, 0x6b4f8b], [5, 3, 0x6b4f8b], [6, 3, 0x6b4f8b],
  // body
  [2, 4, 0x5a3f7a], [3, 4, 0x5a3f7a], [4, 4, 0x5a3f7a], [5, 4, 0x5a3f7a],
  [3, 5, 0x5a3f7a], [4, 5, 0x5a3f7a],
  // eyes
  [3, 4, 0xff4444], [4, 4, 0xff4444],
];

const BAT_FRAME_1: Array<[number, number, number]> = [
  // wings down
  [1, 3, 0x6b4f8b], [2, 3, 0x6b4f8b], [5, 3, 0x6b4f8b], [6, 3, 0x6b4f8b],
  // body
  [2, 4, 0x5a3f7a], [3, 4, 0x5a3f7a], [4, 4, 0x5a3f7a], [5, 4, 0x5a3f7a],
  [3, 5, 0x5a3f7a], [4, 5, 0x5a3f7a],
  // wings down position
  [0, 5, 0x6b4f8b], [1, 5, 0x6b4f8b], [6, 5, 0x6b4f8b], [7, 5, 0x6b4f8b],
  [0, 6, 0x6b4f8b], [7, 6, 0x6b4f8b],
  // eyes
  [3, 4, 0xff4444], [4, 4, 0xff4444],
];

// --- Rat frames (8x8) ---
const RAT_FRAME_0: Array<[number, number, number]> = [
  // ears
  [2, 2, 0x8b6b4b], [5, 2, 0x8b6b4b],
  // head
  [2, 3, 0x8b6b4b], [3, 3, 0x8b6b4b], [4, 3, 0x8b6b4b], [5, 3, 0x8b6b4b],
  // body
  [1, 4, 0x7a5a3b], [2, 4, 0x7a5a3b], [3, 4, 0x7a5a3b], [4, 4, 0x7a5a3b], [5, 4, 0x7a5a3b], [6, 4, 0x7a5a3b],
  [2, 5, 0x7a5a3b], [3, 5, 0x7a5a3b], [4, 5, 0x7a5a3b], [5, 5, 0x7a5a3b],
  // tail (straight)
  [6, 5, 0x6b4f3b], [7, 5, 0x6b4f3b],
  // eyes
  [3, 3, 0x222222], [4, 3, 0x222222],
  // feet
  [2, 6, 0x6b4f3b], [5, 6, 0x6b4f3b],
];

const RAT_FRAME_1: Array<[number, number, number]> = [
  // ears
  [2, 2, 0x8b6b4b], [5, 2, 0x8b6b4b],
  // head
  [2, 3, 0x8b6b4b], [3, 3, 0x8b6b4b], [4, 3, 0x8b6b4b], [5, 3, 0x8b6b4b],
  // body
  [1, 4, 0x7a5a3b], [2, 4, 0x7a5a3b], [3, 4, 0x7a5a3b], [4, 4, 0x7a5a3b], [5, 4, 0x7a5a3b], [6, 4, 0x7a5a3b],
  [2, 5, 0x7a5a3b], [3, 5, 0x7a5a3b], [4, 5, 0x7a5a3b], [5, 5, 0x7a5a3b],
  // tail (flicked up)
  [6, 4, 0x6b4f3b], [7, 3, 0x6b4f3b],
  // eyes
  [3, 3, 0x222222], [4, 3, 0x222222],
  // feet (alt position)
  [3, 6, 0x6b4f3b], [4, 6, 0x6b4f3b],
];

const FRAMES: Record<CreatureType, [Array<[number, number, number]>, Array<[number, number, number]>]> = {
  slime: [SLIME_FRAME_0, SLIME_FRAME_1],
  bat: [BAT_FRAME_0, BAT_FRAME_1],
  rat: [RAT_FRAME_0, RAT_FRAME_1],
};

const CREATURE_SPEED: Record<CreatureType, number> = {
  slime: 0.25,
  bat: 0.3,
  rat: 0.5,
};

const FLEE_DISTANCE = 80;
const FLEE_RETURN_DISTANCE = 150;
const FLEE_SPEED_MULT = 2;
const ANIM_INTERVAL = 30; // ~500ms at 60fps

export class AmbientCreature extends Container {
  private type: CreatureType;
  private gfx: Graphics;
  private shadowGfx: Graphics;
  private patrolStart: { x: number; y: number };
  private patrolEnd: { x: number; y: number };
  private progress = 0; // 0..1 along patrol
  private direction = 1; // 1 = toward end, -1 = toward start
  private frameIndex = 0;
  private animTimer = 0;
  private time = 0;
  private fleeing = false;
  private fleeDirection = { x: 0, y: 0 };
  private fleeDistance = 0;
  private dead = false;
  private fadeAlpha = 1;

  constructor(
    type: CreatureType,
    patrolStart: { x: number; y: number },
    patrolEnd: { x: number; y: number },
  ) {
    super();
    this.type = type;
    this.patrolStart = patrolStart;
    this.patrolEnd = patrolEnd;

    // Shadow underneath
    this.shadowGfx = new Graphics();
    this.shadowGfx.ellipse(8, 15, 6, 2).fill({ color: 0x000000, alpha: 0.2 });
    this.addChild(this.shadowGfx);

    // Creature graphics
    this.gfx = new Graphics();
    this.addChild(this.gfx);

    // Start at patrol start position
    this.position.set(patrolStart.x, patrolStart.y);
    this.drawFrame();
  }

  tick(dt: number, agentPositions: Array<{ x: number; y: number }>): void {
    if (this.dead) return;

    this.time += dt;
    this.animTimer += dt;

    // Frame cycling
    if (this.animTimer >= ANIM_INTERVAL) {
      this.animTimer = 0;
      this.frameIndex = (this.frameIndex + 1) % 2;
      this.drawFrame();
    }

    const speed = CREATURE_SPEED[this.type];

    // Check for nearby agents
    const nearest = this.findNearestAgent(agentPositions);

    if (!this.fleeing && nearest !== null && nearest.dist < FLEE_DISTANCE) {
      this.fleeing = true;
      this.fleeDistance = 0;
      // Flee opposite direction from agent
      const dx = this.position.x - nearest.x;
      const dy = this.position.y - nearest.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      this.fleeDirection = { x: dx / len, y: dy / len };
    }

    if (this.fleeing) {
      const fleeSpeed = speed * FLEE_SPEED_MULT * dt;
      this.position.x += this.fleeDirection.x * fleeSpeed;
      this.position.y += this.fleeDirection.y * fleeSpeed;
      this.fleeDistance += fleeSpeed;

      if (this.fleeDistance >= FLEE_RETURN_DISTANCE) {
        // Fade out and die
        this.fadeAlpha -= 0.03 * dt;
        this.alpha = Math.max(0, this.fadeAlpha);
        if (this.fadeAlpha <= 0) {
          this.dead = true;
        }
      }
    } else {
      // Normal patrol
      const dx = this.patrolEnd.x - this.patrolStart.x;
      const dy = this.patrolEnd.y - this.patrolStart.y;
      const patrolLen = Math.sqrt(dx * dx + dy * dy) || 1;
      const step = (speed * dt) / patrolLen;
      this.progress += step * this.direction;

      if (this.progress >= 1) {
        this.progress = 1;
        this.direction = -1;
      } else if (this.progress <= 0) {
        this.progress = 0;
        this.direction = 1;
      }

      const baseX = this.patrolStart.x + dx * this.progress;
      const baseY = this.patrolStart.y + dy * this.progress;

      // Type-specific movement flavor
      let offsetY = 0;
      if (this.type === "slime") {
        // Bouncing
        offsetY = -Math.abs(Math.sin(this.time * 0.08)) * 3;
      } else if (this.type === "bat") {
        // Hovering sin wave
        offsetY = Math.sin(this.time * 0.06) * 4;
      }
      // Rat: no vertical offset, just moves faster (handled by speed table)

      this.position.set(baseX, baseY + offsetY);
    }
  }

  isDead(): boolean {
    return this.dead;
  }

  private findNearestAgent(
    agentPositions: Array<{ x: number; y: number }>,
  ): { x: number; y: number; dist: number } | null {
    let closest: { x: number; y: number; dist: number } | null = null;
    for (const agent of agentPositions) {
      const dx = this.position.x - agent.x;
      const dy = this.position.y - agent.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (closest === null || dist < closest.dist) {
        closest = { x: agent.x, y: agent.y, dist };
      }
    }
    return closest;
  }

  private drawFrame(): void {
    this.gfx.clear();
    const frames = FRAMES[this.type];
    const pixels = frames[this.frameIndex];
    for (const [x, y, color] of pixels) {
      this.gfx.rect(x * P, y * P, P, P).fill({ color });
    }
  }
}
