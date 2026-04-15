import { Graphics } from "pixi.js";
import type { NodeStatus } from "../../protocol/events";
import { THEME, ROOM_WIDTH } from "./theme";
import type { LayoutNode } from "./layout";

export class Corridor extends Graphics {
  private fromNode: LayoutNode;
  private toNode: LayoutNode;
  private dashOffset = 0;

  constructor(from: LayoutNode, to: LayoutNode) {
    super();
    this.fromNode = from;
    this.toNode = to;
    this.draw(THEME.corridorDefault, 2, false);
  }

  update(fromStatus: NodeStatus, toStatus: NodeStatus, isBlocked: boolean) {
    let color: number = THEME.corridorDefault;
    let width = 2;

    if (isBlocked) {
      color = THEME.corridorBlocked;
      width = 2;
    } else if (fromStatus === "completed" && toStatus === "completed") {
      color = THEME.corridorCompleted;
      width = 2;
    } else if (
      fromStatus === "in_progress" ||
      toStatus === "in_progress"
    ) {
      color = THEME.corridorActive;
      width = 2.5;
    }

    this.draw(color, width, isBlocked);
  }

  tick(dt: number) {
    this.dashOffset += dt * 0.5;
  }

  private draw(color: number, width: number, blocked: boolean) {
    this.clear();

    const x1 = this.fromNode.x + ROOM_WIDTH / 2;
    const y1 = this.fromNode.y;
    const x2 = this.toNode.x - ROOM_WIDTH / 2;
    const y2 = this.toNode.y;

    // Bezier control points for a gentle curve
    const midX = (x1 + x2) / 2;

    this.moveTo(x1, y1)
      .bezierCurveTo(midX, y1, midX, y2, x2, y2)
      .stroke({ color, width, alpha: 0.8 });

    // Blocked marker: X at midpoint
    if (blocked) {
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const s = 8;
      this.moveTo(mx - s, my - s)
        .lineTo(mx + s, my + s)
        .stroke({ color: THEME.corridorBlocked, width: 3 });
      this.moveTo(mx + s, my - s)
        .lineTo(mx - s, my + s)
        .stroke({ color: THEME.corridorBlocked, width: 3 });
    }

    // Arrow head at destination
    const arrowSize = 6;
    this.moveTo(x2, y2)
      .lineTo(x2 - arrowSize, y2 - arrowSize)
      .moveTo(x2, y2)
      .lineTo(x2 - arrowSize, y2 + arrowSize)
      .stroke({ color, width: width * 0.8 });
  }
}
