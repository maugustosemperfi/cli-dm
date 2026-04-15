import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { AgentRole } from "../../protocol/events";
import { AGENT_HEX } from "./theme";

// 16x16 treasure chest pixel art (sparse array)
const CHEST_PIXELS: Array<[number, number, number]> = [
  // Base (brown body)
  ...[3,6,4,6,5,6,6,6,7,6,8,6,9,6,10,6,11,6,12,6].reduce<Array<[number,number,number]>>((a,_,i,arr) => {
    if (i % 2 === 0) a.push([arr[i], arr[i+1], 0x8B4513]);
    return a;
  }, []),
  ...[3,7,4,7,5,7,6,7,7,7,8,7,9,7,10,7,11,7,12,7].reduce<Array<[number,number,number]>>((a,_,i,arr) => {
    if (i % 2 === 0) a.push([arr[i], arr[i+1], 0x8B4513]);
    return a;
  }, []),
  ...[3,8,4,8,5,8,6,8,7,8,8,8,9,8,10,8,11,8,12,8].reduce<Array<[number,number,number]>>((a,_,i,arr) => {
    if (i % 2 === 0) a.push([arr[i], arr[i+1], 0x654321]);
    return a;
  }, []),
  ...[3,9,4,9,5,9,6,9,7,9,8,9,9,9,10,9,11,9,12,9].reduce<Array<[number,number,number]>>((a,_,i,arr) => {
    if (i % 2 === 0) a.push([arr[i], arr[i+1], 0x654321]);
    return a;
  }, []),
  // Lid (lighter brown)
  ...[3,4,4,4,5,4,6,4,7,4,8,4,9,4,10,4,11,4,12,4].reduce<Array<[number,number,number]>>((a,_,i,arr) => {
    if (i % 2 === 0) a.push([arr[i], arr[i+1], 0xA0522D]);
    return a;
  }, []),
  ...[3,5,4,5,5,5,6,5,7,5,8,5,9,5,10,5,11,5,12,5].reduce<Array<[number,number,number]>>((a,_,i,arr) => {
    if (i % 2 === 0) a.push([arr[i], arr[i+1], 0xA0522D]);
    return a;
  }, []),
  // Gold clasp
  [7, 6, 0xFFD700], [8, 6, 0xFFD700],
  [7, 7, 0xFFD700], [8, 7, 0xFFD700],
  // Highlight on lid
  [5, 4, 0xCD853F], [6, 4, 0xCD853F],
];

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
  type: "sparkle" | "coin";
}

export class LootEffect extends Container {
  role: AgentRole;
  private elapsed = 0;
  private maxLife = 120; // ~2 seconds at 60fps
  private particles: Particle[] = [];
  private particleGfx: Graphics;
  private xpText: Text;

  constructor(x: number, y: number, role: AgentRole) {
    super();
    this.role = role;
    this.position.set(x, y);

    const roleColor = AGENT_HEX[role] ?? 0x8b9aab;

    // Chest sprite (draw then convert to texture would need app ref, use Graphics directly)
    const chestGfx = new Graphics();
    for (const [px, py, color] of CHEST_PIXELS) {
      chestGfx.rect(px * 2 - 16, py * 2 - 16, 2, 2).fill({ color });
    }
    this.addChild(chestGfx);

    // XP text
    this.xpText = new Text({
      text: "+100 XP",
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 14,
        fontWeight: "bold",
        fill: 0xFFD700,
        stroke: { color: 0x000000, width: 2 },
      }),
    });
    this.xpText.anchor.set(0.5, 1);
    this.xpText.position.set(0, -20);
    this.addChild(this.xpText);

    // Particle graphics
    this.particleGfx = new Graphics();
    this.addChild(this.particleGfx);

    // Spawn sparkle particles
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI * 2 * i) / 10 + (Math.random() - 0.5) * 0.5;
      const speed = 1.5 + Math.random() * 2;
      this.particles.push({
        x: 0, y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 60 + Math.random() * 30,
        maxLife: 60 + Math.random() * 30,
        color: [0xFFD700, 0xFFFFFF, roleColor][Math.floor(Math.random() * 3)],
        size: 2 + Math.random() * 2,
        type: "sparkle",
      });
    }

    // Coin particles
    for (let i = 0; i < 5; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      const speed = 2 + Math.random() * 1.5;
      this.particles.push({
        x: (Math.random() - 0.5) * 10,
        y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2,
        life: 50 + Math.random() * 20,
        maxLife: 50 + Math.random() * 20,
        color: 0xFFD700,
        size: 3,
        type: "coin",
      });
    }
  }

  isDone(): boolean {
    return this.elapsed >= this.maxLife;
  }

  tick(dt: number) {
    this.elapsed += dt;
    const progress = this.elapsed / this.maxLife;

    // XP text floats up and fades
    this.xpText.position.y = -20 - progress * 40;
    this.xpText.alpha = Math.max(0, 1 - progress * 1.5);

    // Chest fades after midpoint
    if (progress > 0.3) {
      (this.children[0] as Container).alpha = Math.max(0, 1 - (progress - 0.3) * 2);
    }

    // Particles
    this.particleGfx.clear();
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.05 * dt; // gravity

      const alpha = Math.max(0, p.life / p.maxLife);

      if (p.type === "coin") {
        this.particleGfx.circle(p.x, p.y, p.size * (0.5 + alpha * 0.5))
          .fill({ color: p.color, alpha });
        // Coin highlight
        this.particleGfx.circle(p.x - 1, p.y - 1, 1)
          .fill({ color: 0xFFF8DC, alpha: alpha * 0.6 });
      } else {
        // Sparkle: rotating square effect
        const s = p.size * alpha;
        this.particleGfx.rect(p.x - s / 2, p.y - s / 2, s, s)
          .fill({ color: p.color, alpha });
      }
    }
  }
}
