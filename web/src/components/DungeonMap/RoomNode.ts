import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { NodeStatus } from "../../protocol/events";
import { THEME, ROOM_WIDTH, ROOM_HEIGHT, statusColor, AGENT_HEX } from "./theme";

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

  constructor(nodeId: string, label: string, x: number, y: number) {
    super();
    this.nodeId = nodeId;
    this.position.set(x - ROOM_WIDTH / 2, y - ROOM_HEIGHT / 2);
    this.eventMode = "static";
    this.cursor = "pointer";

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

    this.drawRoom(THEME.statusPending);
  }

  update(status: NodeStatus, assigneeName?: string, assigneeRole?: string) {
    this.currentStatus = status;
    const color = statusColor(status);
    this.drawRoom(color);

    if (assigneeName) {
      this.assigneeText.text = assigneeName;
      if (assigneeRole && AGENT_HEX[assigneeRole] !== undefined) {
        this.assigneeText.style.fill = AGENT_HEX[assigneeRole];
      }
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

  tick(dt: number) {
    if (this.currentStatus === "in_progress") {
      this.pulseTime += dt * 0.03;
      const pulse = 0.6 + Math.sin(this.pulseTime) * 0.15;
      this.statusDot.alpha = pulse;
    } else {
      this.statusDot.alpha = 1;
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
