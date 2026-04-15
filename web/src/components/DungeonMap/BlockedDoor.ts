import { Container, Graphics } from "pixi.js";

const P = 2; // pixel scale

// Post color (dark brown)
const POST_COLOR = 0x654321;
// Bar color (iron gray)
const BAR_COLOR = 0x6d6f78;
// Lock color (gold)
const LOCK_COLOR = 0xbfa85b;
// Chain color
const CHAIN_COLOR = 0x8b9aab;
// Glow color
const GLOW_COLOR = 0xbf6b5b;

const SHAKE_AMPLITUDE = 2;
const OPEN_DURATION = 60; // ~1s at 60fps

interface DoorParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
}

export class BlockedDoor extends Container {
  private doorGfx: Graphics;
  private glowGfx: Graphics;
  private chainGfx: Graphics;
  private lockGfx: Graphics;
  private particleGfx: Graphics;

  private time = 0;
  private opening = false;
  private openTimer = 0;
  private done = false;
  private shaking = false;
  private particles: DoorParticle[] = [];

  // Bar retraction progress (0 = closed, 1 = fully open)
  private barProgress = 0;

  constructor(x: number, y: number, doorRotation: number) {
    super();
    this.position.set(x, y);
    this.rotation = doorRotation;

    // Red glow behind
    this.glowGfx = new Graphics();
    this.addChild(this.glowGfx);

    // Door frame (posts and bars)
    this.doorGfx = new Graphics();
    this.addChild(this.doorGfx);

    // Chains
    this.chainGfx = new Graphics();
    this.addChild(this.chainGfx);

    // Lock
    this.lockGfx = new Graphics();
    this.addChild(this.lockGfx);

    // Particles
    this.particleGfx = new Graphics();
    this.addChild(this.particleGfx);

    this.drawDoor();
    this.drawChains();
    this.drawLock();
  }

  tick(dt: number): void {
    if (this.done) return;

    this.time += dt;

    if (this.opening) {
      this.tickOpen(dt);
      return;
    }

    // Pulsing glow
    this.glowGfx.clear();
    const glowAlpha = 0.08 + Math.sin(this.time * 0.04) * 0.04;
    this.glowGfx.ellipse(0, 0, 20, 24).fill({ color: GLOW_COLOR, alpha: glowAlpha });

    // Shake effect (always slightly vibrating when blocked)
    this.shaking = true;
    if (this.shaking) {
      const shakeX = (Math.random() - 0.5) * SHAKE_AMPLITUDE * Math.sin(this.time * 0.15);
      this.doorGfx.position.x = shakeX;
      this.chainGfx.position.x = shakeX * 0.5;
      this.lockGfx.position.x = shakeX * 0.7;
    }
  }

  open(): void {
    if (this.opening) return;
    this.opening = true;
    this.openTimer = 0;

    // Spawn lock-break particles
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + (Math.random() - 0.5) * 0.4;
      const speed = 1 + Math.random() * 2;
      this.particles.push({
        x: 0,
        y: 0,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1,
        life: 25 + Math.random() * 15,
        maxLife: 30,
        color: [LOCK_COLOR, 0xffffff, CHAIN_COLOR][Math.floor(Math.random() * 3)],
        size: 1.5 + Math.random() * 2,
      });
    }

    // Spawn chain-link particles
    for (let i = 0; i < 6; i++) {
      this.particles.push({
        x: (Math.random() - 0.5) * 10,
        y: (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 3,
        vy: -1 + Math.random() * -1.5,
        life: 20 + Math.random() * 10,
        maxLife: 25,
        color: CHAIN_COLOR,
        size: 1 + Math.random(),
      });
    }
  }

  isDone(): boolean {
    return this.done;
  }

  private tickOpen(dt: number): void {
    this.openTimer += dt;
    const progress = Math.min(1, this.openTimer / OPEN_DURATION);

    // Lock disappears immediately (flash)
    if (progress < 0.1) {
      this.lockGfx.alpha = Math.sin(this.openTimer * 1.5) > 0 ? 1 : 0;
    } else {
      this.lockGfx.alpha = 0;
    }

    // Chains fade quickly
    this.chainGfx.alpha = Math.max(0, 1 - progress * 4);

    // Bars retract left/right
    this.barProgress = Math.min(1, progress * 2);
    this.drawDoor();

    // Posts fade
    if (progress > 0.5) {
      const postAlpha = Math.max(0, 1 - (progress - 0.5) * 2);
      this.doorGfx.alpha = postAlpha;
    }

    // Glow fades
    this.glowGfx.clear();
    const glowAlpha = Math.max(0, 0.15 * (1 - progress));
    this.glowGfx.ellipse(0, 0, 20, 24).fill({ color: GLOW_COLOR, alpha: glowAlpha });

    // Reset shake
    this.doorGfx.position.x = 0;

    // Particles
    this.tickParticles(dt);

    if (progress >= 1 && this.particles.every((p) => p.life <= 0)) {
      this.done = true;
    }
  }

  private drawDoor(): void {
    this.doorGfx.clear();

    const postWidth = 4;
    const postHeight = 40;
    const halfWidth = 16; // half the total door width

    // Left post
    const leftPostAlpha = this.opening ? Math.max(0, 1 - this.barProgress * 0.5) : 1;
    this.doorGfx
      .rect(-halfWidth - postWidth / 2, -postHeight / 2, postWidth, postHeight)
      .fill({ color: POST_COLOR, alpha: leftPostAlpha });

    // Right post
    this.doorGfx
      .rect(halfWidth - postWidth / 2, -postHeight / 2, postWidth, postHeight)
      .fill({ color: POST_COLOR, alpha: leftPostAlpha });

    // Three horizontal bars (retract when opening)
    const barPositions = [-12, 0, 12];
    for (const barY of barPositions) {
      const retract = this.barProgress * halfWidth;
      // Left half of bar
      const leftBarStart = -halfWidth + retract;
      const leftBarEnd = -2;
      if (leftBarStart < leftBarEnd) {
        this.doorGfx
          .rect(leftBarStart, barY - 1, leftBarEnd - leftBarStart, P)
          .fill({ color: BAR_COLOR });
      }
      // Right half of bar
      const rightBarStart = 2;
      const rightBarEnd = halfWidth - retract;
      if (rightBarStart < rightBarEnd) {
        this.doorGfx
          .rect(rightBarStart, barY - 1, rightBarEnd - rightBarStart, P)
          .fill({ color: BAR_COLOR });
      }
    }
  }

  private drawChains(): void {
    this.chainGfx.clear();

    // Left chain (links as small rects)
    for (let i = 0; i < 5; i++) {
      const y = -16 + i * 7;
      const x = -18;
      // Chain link: small oval-like shape
      this.chainGfx.rect(x, y, 3, 2).stroke({ color: CHAIN_COLOR, width: 1 });
      this.chainGfx.rect(x + 1, y + 2, 3, 2).stroke({ color: CHAIN_COLOR, width: 1 });
    }

    // Right chain
    for (let i = 0; i < 5; i++) {
      const y = -16 + i * 7;
      const x = 15;
      this.chainGfx.rect(x, y, 3, 2).stroke({ color: CHAIN_COLOR, width: 1 });
      this.chainGfx.rect(x + 1, y + 2, 3, 2).stroke({ color: CHAIN_COLOR, width: 1 });
    }
  }

  private drawLock(): void {
    this.lockGfx.clear();

    // Lock body (6x8 pixel)
    const lw = 6 * P;
    const lh = 5 * P;
    this.lockGfx
      .rect(-lw / 2, -lh / 2, lw, lh)
      .fill({ color: LOCK_COLOR });

    // Lock shackle (arc on top)
    this.lockGfx
      .rect(-3 * P / 2, -lh / 2 - 3 * P, P, 3 * P)
      .fill({ color: LOCK_COLOR });
    this.lockGfx
      .rect(3 * P / 2 - P, -lh / 2 - 3 * P, P, 3 * P)
      .fill({ color: LOCK_COLOR });
    this.lockGfx
      .rect(-3 * P / 2, -lh / 2 - 3 * P, 3 * P, P)
      .fill({ color: LOCK_COLOR });

    // Keyhole
    this.lockGfx
      .circle(0, -P / 2, P)
      .fill({ color: 0x222222 });
    this.lockGfx
      .rect(-P / 2, 0, P, P * 2)
      .fill({ color: 0x222222 });
  }

  private tickParticles(dt: number): void {
    this.particleGfx.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.05 * dt; // gravity

      const alpha = Math.max(0, p.life / p.maxLife);
      const size = p.size * (0.5 + alpha * 0.5);
      this.particleGfx
        .rect(p.x - size / 2, p.y - size / 2, size, size)
        .fill({ color: p.color, alpha });
    }
  }
}
