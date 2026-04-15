import { Container, Graphics } from "pixi.js";

const P = 2;

const FLAME_COLORS = [0xffa500, 0xff8c00, 0xffd700, 0xff6600];

export class TorchLight extends Container {
  private glowGfx: Graphics;
  private bracketGfx: Graphics;
  private flameGfx: Graphics;
  private time = 0;
  private flickerOffset: number;
  private nightMultiplier = 1.0;

  constructor(x: number, y: number, facingLeft: boolean) {
    super();
    this.position.set(x, y);
    if (facingLeft) {
      this.scale.x = -1;
    }
    this.flickerOffset = Math.random() * 1000;

    this.glowGfx = new Graphics();
    this.bracketGfx = new Graphics();
    this.flameGfx = new Graphics();

    this.addChild(this.glowGfx);
    this.addChild(this.bracketGfx);
    this.addChild(this.flameGfx);

    this.drawBracket();
    this.drawFlame();
    this.drawGlow();
  }

  private drawBracket(): void {
    this.bracketGfx.clear();
    // Handle: 2x4 pixels at center (wood brown)
    this.bracketGfx.rect(-1 * P, -4 * P, 2 * P, 4 * P).fill(0x654321);
    // Mount: 2x2 pixels below handle (iron gray)
    this.bracketGfx.rect(-1 * P, 0, 2 * P, 2 * P).fill(0x6d6f78);
  }

  private drawFlame(): void {
    this.flameGfx.clear();
    const baseY = -6 * P;
    const jitter = Math.sin(this.time * 0.12 + this.flickerOffset) * 1;

    for (let i = 0; i < 3; i++) {
      const colorIndex =
        Math.floor(
          Math.abs(Math.sin(this.time * 0.08 + this.flickerOffset + i)) *
            FLAME_COLORS.length,
        ) % FLAME_COLORS.length;
      const yPos = baseY - i * P + jitter;
      this.flameGfx
        .rect(-1 * P, yPos, 2 * P, 1 * P)
        .fill(FLAME_COLORS[colorIndex]);
    }
  }

  private drawGlow(): void {
    this.glowGfx.clear();
    const radius = 14 + Math.sin(this.time * 0.06 + this.flickerOffset) * 3;
    const alpha =
      (0.1 + Math.sin(this.time * 0.05 + this.flickerOffset) * 0.04) *
      this.nightMultiplier;
    this.glowGfx.circle(0, -6 * P, radius).fill({ color: 0xffa500, alpha });
  }

  tick(dt: number): void {
    this.time += dt;
    this.drawFlame();
    this.drawGlow();
  }

  setNightMultiplier(m: number): void {
    this.nightMultiplier = m;
  }
}
