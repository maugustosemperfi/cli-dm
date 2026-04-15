import { Container, Graphics, Text, TextStyle } from "pixi.js";

// Wooden tones
const WOOD_COLOR = 0x8b6914;
const PANEL_COLOR = 0x704214;
// Golden glow / accents
const GLOW_COLOR = 0xdaa520;
const PLATE_BG = 0xc8b560;
const PLATE_TEXT_COLOR = 0x2b2d31;

const OPEN_SPEED = 0.025; // progress per frame-tick
const LINGER_DURATION = 300; // ~5 s at 60 fps
const FADE_DURATION = 60; // ~1 s

type DoorState = "closed" | "opening" | "open" | "lingering" | "fading" | "done";

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
}

export class DiscoveryDoor extends Container {
  private frameGfx: Graphics;
  private leftPanel: Graphics;
  private rightPanel: Graphics;
  private glowGfx: Graphics;
  private sparkGfx: Graphics;
  private nameplate: Container;

  private state: DoorState = "closed";
  private time = 0;
  private openProgress = 0;
  private lingerTimer = 0;
  private fadeTimer = 0;
  private sparks: Spark[] = [];

  readonly dirName: string;

  constructor(x: number, y: number, angle: number, dirName: string) {
    super();
    this.position.set(x, y);
    this.rotation = angle;
    this.dirName = dirName;

    // Golden glow behind door
    this.glowGfx = new Graphics();
    this.addChild(this.glowGfx);

    // Door frame (posts + lintel)
    this.frameGfx = new Graphics();
    this.addChild(this.frameGfx);

    // Swinging panels
    this.leftPanel = new Graphics();
    this.addChild(this.leftPanel);
    this.rightPanel = new Graphics();
    this.addChild(this.rightPanel);

    // Sparks
    this.sparkGfx = new Graphics();
    this.addChild(this.sparkGfx);

    // Nameplate (plate bg + text)
    this.nameplate = new Container();
    const plateBg = new Graphics();
    const truncName = dirName.length > 16 ? dirName.slice(0, 15) + "\u2026" : dirName;
    const plateW = Math.max(28, truncName.length * 5.5 + 8);
    plateBg.roundRect(-plateW / 2, -5, plateW, 11, 2).fill({ color: PLATE_BG });
    this.nameplate.addChild(plateBg);
    const label = new Text({
      text: truncName,
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 8,
        fill: PLATE_TEXT_COLOR,
      }),
    });
    label.anchor.set(0.5, 0.5);
    label.position.set(0, 0.5);
    this.nameplate.addChild(label);
    this.nameplate.position.set(0, -30);
    this.addChild(this.nameplate);

    this.drawFrame();
    this.drawPanels();

    // Start opening immediately
    this.state = "opening";
    this.spawnOpenSparks();
  }

  tick(dt: number): void {
    if (this.state === "done") return;
    this.time += dt;

    switch (this.state) {
      case "opening": {
        this.openProgress = Math.min(1, this.openProgress + OPEN_SPEED * dt);
        this.drawPanels();
        if (this.openProgress >= 1) {
          this.state = "lingering";
          this.lingerTimer = 0;
        }
        break;
      }
      case "lingering": {
        this.lingerTimer += dt;
        if (this.lingerTimer >= LINGER_DURATION) {
          this.state = "fading";
          this.fadeTimer = 0;
        }
        break;
      }
      case "fading": {
        this.fadeTimer += dt;
        const progress = Math.min(1, this.fadeTimer / FADE_DURATION);
        this.alpha = 1 - progress;
        if (progress >= 1) {
          this.state = "done";
        }
        break;
      }
    }

    // Glow pulse
    this.glowGfx.clear();
    let glowAlpha: number;
    if (this.state === "opening") {
      glowAlpha = 0.06 + this.openProgress * 0.16;
    } else if (this.state === "lingering") {
      glowAlpha = 0.16 + Math.sin(this.time * 0.05) * 0.06;
    } else {
      glowAlpha = 0.08;
    }
    this.glowGfx.ellipse(0, 0, 24, 30).fill({ color: GLOW_COLOR, alpha: glowAlpha });

    // Sparks
    this.tickSparks(dt);
  }

  forceFade(): void {
    if (this.state !== "done" && this.state !== "fading") {
      this.state = "fading";
      this.fadeTimer = 0;
    }
  }

  isDone(): boolean {
    return this.state === "done";
  }

  // ---------------------------------------------------------------------------
  // Drawing helpers
  // ---------------------------------------------------------------------------

  private drawFrame(): void {
    this.frameGfx.clear();
    const postW = 4;
    const postH = 44;
    const halfW = 16;

    // Left post
    this.frameGfx
      .rect(-halfW - postW / 2, -postH / 2, postW, postH)
      .fill({ color: WOOD_COLOR });
    // Right post
    this.frameGfx
      .rect(halfW - postW / 2, -postH / 2, postW, postH)
      .fill({ color: WOOD_COLOR });
    // Lintel
    this.frameGfx
      .rect(-halfW - postW / 2, -postH / 2, halfW * 2 + postW, 3)
      .fill({ color: WOOD_COLOR });
  }

  private drawPanels(): void {
    const halfW = 14;
    const panelH = 38;
    const swing = this.openProgress * (Math.PI / 3); // 60 ° max

    // Left panel — swings outward
    this.leftPanel.clear();
    this.leftPanel.position.set(-halfW, 0);
    this.leftPanel.pivot.set(0, 0);
    this.leftPanel.rotation = -swing;
    this.leftPanel.rect(0, -panelH / 2, halfW, panelH).fill({ color: PANEL_COLOR });
    for (let i = 0; i < 4; i++) {
      const y = -panelH / 2 + 4 + i * 9;
      this.leftPanel.rect(1, y, halfW - 2, 1).fill({ color: WOOD_COLOR, alpha: 0.4 });
    }
    this.leftPanel.circle(halfW - 3, 0, 1.5).fill({ color: GLOW_COLOR });

    // Right panel
    this.rightPanel.clear();
    this.rightPanel.position.set(halfW, 0);
    this.rightPanel.pivot.set(0, 0);
    this.rightPanel.rotation = swing;
    this.rightPanel.rect(-halfW, -panelH / 2, halfW, panelH).fill({ color: PANEL_COLOR });
    for (let i = 0; i < 4; i++) {
      const y = -panelH / 2 + 4 + i * 9;
      this.rightPanel.rect(-halfW + 1, y, halfW - 2, 1).fill({ color: WOOD_COLOR, alpha: 0.4 });
    }
    this.rightPanel.circle(-halfW + 3, 0, 1.5).fill({ color: GLOW_COLOR });
  }

  private spawnOpenSparks(): void {
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI * 2 * i) / 10 + (Math.random() - 0.5) * 0.5;
      const speed = 0.8 + Math.random() * 1.5;
      this.sparks.push({
        x: (Math.random() - 0.5) * 8,
        y: (Math.random() - 0.5) * 12,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.6,
        life: 20 + Math.random() * 15,
        maxLife: 30,
        color: [GLOW_COLOR, 0xffd700, 0xffffff][Math.floor(Math.random() * 3)],
        size: 1 + Math.random() * 2,
      });
    }
  }

  private tickSparks(dt: number): void {
    this.sparkGfx.clear();
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 0.04 * dt; // gravity

      const alpha = Math.max(0, s.life / s.maxLife);
      const size = s.size * (0.5 + alpha * 0.5);
      this.sparkGfx
        .rect(s.x - size / 2, s.y - size / 2, size, size)
        .fill({ color: s.color, alpha });
    }
  }
}
