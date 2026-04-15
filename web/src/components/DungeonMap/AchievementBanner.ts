import { Container, Graphics, Text, TextStyle } from "pixi.js";

const SCROLL_WIDTH = 120;
const SCROLL_HEIGHT = 36;
const UNFURL_DURATION = 30;   // ~0.5s
const HOLD_DURATION = 180;    // ~3s
const FADE_DURATION = 60;     // ~1s
const SCROLL_COLOR = 0xd4c5a0;
const SCROLL_EDGE = 0xbfa85b;
const TEXT_COLOR = 0x2b2d31;
const SPARKLE_COLOR = 0xffd700;

export type AchievementType =
  | "first_edit" | "first_build" | "first_test"
  | "level_5" | "level_10"
  | "explorer_10" | "explorer_25"
  | "error_survivor";

const ACHIEVEMENT_TEXT: Record<AchievementType, string> = {
  first_edit: "First Blood!",
  first_build: "Master Builder!",
  first_test: "Test Warrior!",
  level_5: "Veteran (Lv.5)",
  level_10: "Champion (Lv.10)",
  explorer_10: "Pathfinder",
  explorer_25: "Cartographer",
  error_survivor: "Resilient!",
};

type BannerState = "unfurling" | "holding" | "fading" | "done";

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
}

export class AchievementBanner extends Container {
  private state: BannerState = "unfurling";
  private timer = 0;
  private scrollGfx: Graphics;
  private sparkles: Sparkle[] = [];
  private sparkleGfx: Graphics;
  private bobTime = 0;

  constructor(x: number, y: number, achievementType: AchievementType) {
    super();
    this.position.set(x, y - 60);
    this.scale.y = 0;

    // Scroll background
    this.scrollGfx = new Graphics();
    this.scrollGfx
      .roundRect(-SCROLL_WIDTH / 2, -SCROLL_HEIGHT / 2, SCROLL_WIDTH, SCROLL_HEIGHT, 4)
      .fill({ color: SCROLL_COLOR })
      .stroke({ color: SCROLL_EDGE, width: 1.5 });
    // Roll circles at edges
    this.scrollGfx
      .circle(-SCROLL_WIDTH / 2, 0, 4).fill({ color: SCROLL_EDGE })
      .circle(SCROLL_WIDTH / 2, 0, 4).fill({ color: SCROLL_EDGE });
    this.addChild(this.scrollGfx);

    // Title text
    const titleStyle = new TextStyle({
      fontFamily: "monospace",
      fontSize: 10,
      fontWeight: "bold",
      fill: TEXT_COLOR,
    });
    const title = new Text({ text: ACHIEVEMENT_TEXT[achievementType], style: titleStyle });
    title.anchor.set(0.5, 0.5);
    title.position.set(0, -4);
    this.addChild(title);

    // Subtitle text
    const subStyle = new TextStyle({
      fontFamily: "monospace",
      fontSize: 7,
      fill: 0x666666,
    });
    const subtitle = new Text({ text: "Achievement Unlocked!", style: subStyle });
    subtitle.anchor.set(0.5, 0.5);
    subtitle.position.set(0, 8);
    this.addChild(subtitle);

    // Sparkle graphics layer
    this.sparkleGfx = new Graphics();
    this.addChild(this.sparkleGfx);

    // Initial sparkles radiating from scroll edges
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const angle = (Math.random() - 0.5) * Math.PI;
      this.sparkles.push({
        x: side * SCROLL_WIDTH / 2,
        y: (Math.random() - 0.5) * SCROLL_HEIGHT,
        vx: Math.cos(angle) * (1 + Math.random()) * side,
        vy: Math.sin(angle) * (1 + Math.random()),
        life: 1,
        maxLife: 1,
        color: SPARKLE_COLOR,
        size: 1.5 + Math.random() * 1.5,
      });
    }
  }

  tick(dt: number): void {
    this.timer += dt;

    switch (this.state) {
      case "unfurling": {
        const progress = Math.min(1, this.timer / UNFURL_DURATION);
        this.scale.y = progress;
        if (progress >= 1) {
          this.state = "holding";
          this.timer = 0;
        }
        break;
      }
      case "holding": {
        this.bobTime += dt;
        this.position.y += Math.sin(this.bobTime * 0.03) * 0.5;
        if (this.timer >= HOLD_DURATION) {
          this.state = "fading";
          this.timer = 0;
        }
        break;
      }
      case "fading": {
        const progress = Math.min(1, this.timer / FADE_DURATION);
        this.alpha = 1 - progress;
        if (progress >= 1) {
          this.state = "done";
        }
        break;
      }
    }

    // Tick sparkle particles
    this.sparkleGfx.clear();
    for (let i = this.sparkles.length - 1; i >= 0; i--) {
      const s = this.sparkles[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += 0.04 * dt; // gravity
      s.life -= dt * 0.02;
      if (s.life <= 0) {
        this.sparkles.splice(i, 1);
        continue;
      }
      const a = s.life / s.maxLife;
      this.sparkleGfx.circle(s.x, s.y, s.size * a).fill({ color: s.color, alpha: a });
    }
  }

  isDone(): boolean {
    return this.state === "done";
  }
}
