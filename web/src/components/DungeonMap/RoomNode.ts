import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { NodeStatus } from "../../protocol/events";
import { THEME, ROOM_WIDTH, ROOM_HEIGHT, statusColor, AGENT_HEX } from "./theme";

type RoomDecorType = "bookshelf" | "anvil" | "cauldron" | "scroll_desk" | "terminal" | "crystal" | "portal" | "none";

const ACTION_DECOR: Record<string, RoomDecorType> = {
  read: "bookshelf", build: "anvil", test: "cauldron", edit: "scroll_desk",
  shell: "terminal", thinking: "crystal", network: "portal",
  idle: "none", git: "scroll_desk", error: "none", blocked: "none",
};

const CORNER_RADIUS = 6;
const ACCENT_WIDTH = 4;

export class RoomNode extends Container {
  nodeId: string;
  private bg: Graphics;
  private accent: Graphics;
  private statusDot: Graphics;
  private labelText: Text;
  private assigneeText: Text;
  private glowGraphic: Graphics;
  private currentStatus: NodeStatus = "pending";
  private pulseTime = 0;
  private heatGlow: Graphics;
  private heatLevel = 0;
  private fireGlow: Graphics;
  private fireIntensity = 0;
  private fireEmbers: Array<{ x: number; y: number; vy: number; life: number; size: number }> = [];
  private decorGfx: Graphics;
  private currentDecorAction = "";

  constructor(nodeId: string, label: string, x: number, y: number) {
    super();
    this.nodeId = nodeId;
    this.position.set(x - ROOM_WIDTH / 2, y - ROOM_HEIGHT / 2);
    this.eventMode = "static";
    this.cursor = "pointer";

    // Fire glow (outermost — error propagation)
    this.fireGlow = new Graphics();
    this.fireGlow.alpha = 0;
    this.addChild(this.fireGlow);

    // Heat glow (activity heatmap)
    this.heatGlow = new Graphics();
    this.heatGlow.alpha = 0;
    this.addChild(this.heatGlow);

    // Glow (behind everything)
    this.glowGraphic = new Graphics();
    this.glowGraphic.alpha = 0;
    this.addChild(this.glowGraphic);

    // Background
    this.bg = new Graphics();
    this.addChild(this.bg);

    // Left accent bar
    this.accent = new Graphics();
    this.addChild(this.accent);

    // Status dot
    this.statusDot = new Graphics();
    this.statusDot.position.set(16, 20);
    this.addChild(this.statusDot);

    // Label
    this.labelText = new Text({
      text: label.length > 18 ? label.slice(0, 17) + "..." : label,
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 13,
        fill: THEME.text,
      }),
    });
    this.labelText.position.set(30, 14);
    this.addChild(this.labelText);

    // Assignee
    this.assigneeText = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 11,
        fill: THEME.textMuted,
      }),
    });
    this.assigneeText.position.set(30, 38);
    this.addChild(this.assigneeText);

    this.decorGfx = new Graphics();
    this.decorGfx.position.set(ROOM_WIDTH - 40, 14);
    this.addChild(this.decorGfx);

    this.drawRoom(THEME.statusPending);
  }

  update(status: NodeStatus, assigneeName?: string, assigneeRole?: string, currentAction?: string) {
    this.currentStatus = status;
    const color = statusColor(status);
    this.drawRoom(color);

    if (assigneeName) {
      this.assigneeText.text = assigneeName;
      if (assigneeRole && AGENT_HEX[assigneeRole] !== undefined) {
        this.assigneeText.style.fill = AGENT_HEX[assigneeRole];
      }
    }

    this.updateDecoration(currentAction);
  }

  private updateDecoration(action?: string) {
    const decorType = ACTION_DECOR[action ?? "idle"] ?? "none";
    if (decorType === this.currentDecorAction) return;
    this.currentDecorAction = decorType;
    this.decorGfx.clear();

    switch (decorType) {
      case "bookshelf":
        for (let row = 0; row < 3; row++) {
          const y = row * 8;
          this.decorGfx.rect(0, y, 20, 1).fill({ color: 0x654321 });
          for (let b = 0; b < 4; b++) {
            const bx = 1 + b * 5;
            const bColor = [0x5b8abf, 0xbf6b5b, 0x8b6baf, 0x5baf7b][b];
            this.decorGfx.rect(bx, y - 6, 3, 6).fill({ color: bColor, alpha: 0.7 });
          }
        }
        break;
      case "anvil":
        this.decorGfx.rect(4, 16, 12, 4).fill({ color: 0x6d6f78 });
        this.decorGfx.rect(6, 12, 8, 4).fill({ color: 0x5c5e67 });
        this.decorGfx.rect(2, 10, 16, 2).fill({ color: 0x6d6f78 });
        this.decorGfx.rect(20, 6, 2, 14).fill({ color: 0x654321 });
        this.decorGfx.rect(18, 4, 6, 4).fill({ color: 0x6d6f78 });
        break;
      case "cauldron":
        this.decorGfx.circle(10, 14, 8).fill({ color: 0x3f4147 });
        this.decorGfx.circle(10, 14, 6).fill({ color: 0x5baf7b, alpha: 0.4 });
        this.decorGfx.rect(4, 20, 2, 4).fill({ color: 0x3f4147 });
        this.decorGfx.rect(14, 20, 2, 4).fill({ color: 0x3f4147 });
        this.decorGfx.circle(8, 11, 1.5).fill({ color: 0x5baf7b, alpha: 0.6 });
        this.decorGfx.circle(12, 10, 1).fill({ color: 0x5baf7b, alpha: 0.5 });
        break;
      case "scroll_desk":
        this.decorGfx.rect(0, 14, 22, 3).fill({ color: 0x654321 });
        this.decorGfx.rect(2, 17, 2, 8).fill({ color: 0x654321 });
        this.decorGfx.rect(18, 17, 2, 8).fill({ color: 0x654321 });
        this.decorGfx.rect(4, 10, 14, 4).fill({ color: 0xd4c5a0, alpha: 0.8 });
        this.decorGfx.rect(18, 6, 1, 8).fill({ color: 0xdbdee1, alpha: 0.6 });
        break;
      case "terminal":
        this.decorGfx.rect(2, 4, 16, 12).fill({ color: 0x3f4147 });
        this.decorGfx.rect(4, 6, 12, 8).fill({ color: 0x1a1c1e });
        this.decorGfx.rect(6, 10, 4, 2).fill({ color: 0x5baf7b, alpha: 0.7 });
        this.decorGfx.rect(6, 16, 8, 2).fill({ color: 0x3f4147 });
        this.decorGfx.rect(4, 18, 12, 2).fill({ color: 0x3f4147 });
        break;
      case "crystal":
        this.decorGfx.rect(6, 16, 8, 4).fill({ color: 0x654321 });
        this.decorGfx.circle(10, 12, 6).fill({ color: 0x8b6baf, alpha: 0.3 });
        this.decorGfx.circle(10, 12, 4).fill({ color: 0x8b6baf, alpha: 0.5 });
        this.decorGfx.circle(8, 10, 1.5).fill({ color: 0xdbdee1, alpha: 0.4 });
        break;
      case "portal":
        this.decorGfx.circle(10, 12, 8).stroke({ color: 0x8b6baf, width: 1.5, alpha: 0.4 });
        this.decorGfx.circle(10, 12, 5).stroke({ color: 0x8b6baf, width: 1, alpha: 0.3 });
        for (let i = 0; i < 4; i++) {
          const a = (Math.PI * 2 * i) / 4;
          this.decorGfx.circle(10 + Math.cos(a) * 6, 12 + Math.sin(a) * 6, 1).fill({ color: 0x8b6baf, alpha: 0.5 });
        }
        break;
    }
  }

  highlight(on: boolean) {
    if (on) {
      this.glowGraphic.clear();
      this.glowGraphic
        .roundRect(-4, -4, ROOM_WIDTH + 8, ROOM_HEIGHT + 8, CORNER_RADIUS + 2)
        .fill({ color: THEME.highlight, alpha: 0.15 })
        .stroke({ color: THEME.highlight, width: 2, alpha: 0.6 });
      this.glowGraphic.alpha = 1;
    } else {
      this.glowGraphic.alpha = 0;
    }
  }

  /** Set the activity heat level (0 = cold, higher = hotter) */
  setHeat(heat: number) {
    // Normalize: 0-50 actions = full range
    const intensity = Math.min(1, heat / 50);
    if (Math.abs(intensity - this.heatLevel) < 0.01) return;
    this.heatLevel = intensity;

    this.heatGlow.clear();
    if (intensity > 0.05) {
      // Warm glow: goes from subtle blue to bright orange as heat increases
      const color = intensity > 0.5 ? 0xbf6b5b : 0x5b8abf;
      this.heatGlow
        .roundRect(-6, -6, ROOM_WIDTH + 12, ROOM_HEIGHT + 12, CORNER_RADIUS + 4)
        .fill({ color, alpha: intensity * 0.12 });
      this.heatGlow.alpha = 1;
    } else {
      this.heatGlow.alpha = 0;
    }
  }

  /** Set fire intensity for error propagation (0 = no fire, 1 = fully ablaze) */
  setFire(intensity: number) {
    if (intensity > this.fireIntensity) {
      // Spawn new embers when intensity increases
      for (let i = 0; i < 4; i++) {
        this.fireEmbers.push({
          x: Math.random() * ROOM_WIDTH,
          y: ROOM_HEIGHT - Math.random() * 10,
          vy: -(0.5 + Math.random() * 1.5),
          life: 0.6 + Math.random() * 0.6,
          size: 1 + Math.random() * 2,
        });
      }
    }
    this.fireIntensity = Math.max(this.fireIntensity, intensity);
  }

  tick(dt: number) {
    if (this.currentStatus === "in_progress") {
      this.pulseTime += dt * 0.03;
      const pulse = 0.6 + Math.sin(this.pulseTime) * 0.15;
      this.statusDot.alpha = pulse;
    } else {
      this.statusDot.alpha = 1;
    }

    // Fire decay and ember animation
    if (this.fireIntensity > 0.01) {
      this.fireIntensity *= 0.997;
      this.fireGlow.clear();

      // Room border glow
      this.fireGlow
        .roundRect(-3, -3, ROOM_WIDTH + 6, ROOM_HEIGHT + 6, CORNER_RADIUS + 2)
        .fill({ color: 0xbf6b5b, alpha: this.fireIntensity * 0.15 })
        .stroke({ color: 0xbf6b5b, width: 2, alpha: this.fireIntensity * 0.5 });

      // Animate embers
      for (let i = this.fireEmbers.length - 1; i >= 0; i--) {
        const e = this.fireEmbers[i];
        e.y += e.vy * dt * 0.5;
        e.life -= dt * 0.015;
        e.x += (Math.random() - 0.5) * dt * 0.3; // sway
        if (e.life <= 0) {
          this.fireEmbers.splice(i, 1);
        } else {
          const color = e.life > 0.4 ? 0xbf6b5b : 0xbfa85b;
          this.fireGlow
            .circle(e.x, e.y, e.size * e.life)
            .fill({ color, alpha: e.life * this.fireIntensity });
        }
      }

      this.fireGlow.alpha = 1;
    } else if (this.fireIntensity <= 0.01 && this.fireGlow.alpha > 0) {
      this.fireGlow.clear();
      this.fireGlow.alpha = 0;
      this.fireEmbers = [];
      this.fireIntensity = 0;
    }
  }

  private drawRoom(color: number) {
    // Background
    this.bg.clear();
    this.bg
      .roundRect(0, 0, ROOM_WIDTH, ROOM_HEIGHT, CORNER_RADIUS)
      .fill({ color: THEME.roomFill })
      .stroke({ color: THEME.roomStroke, width: 1 });

    // Left accent
    this.accent.clear();
    this.accent
      .roundRect(0, 0, ACCENT_WIDTH, ROOM_HEIGHT, CORNER_RADIUS)
      .fill({ color });

    // Status dot
    this.statusDot.clear();
    this.statusDot.circle(0, 0, 5).fill({ color });
  }
}
