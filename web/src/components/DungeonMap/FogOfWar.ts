import { Graphics } from "pixi.js";
import { ROOM_WIDTH, ROOM_HEIGHT } from "./theme";

const FOG_COLOR = 0x111115;
const FOG_UNREVEALED = 0.7;
const FOG_ADJACENT = 0.3;
const FOG_REVEALED = 0.0;
const FOG_FADE_SPEED = 0.02;

interface FogCell {
  nodeId: string;
  x: number;
  y: number;
  currentAlpha: number;
  targetAlpha: number;
}

export class FogOfWar extends Graphics {
  private cells: Map<string, FogCell> = new Map();
  private dirty = true;

  constructor() {
    super();
    this.eventMode = "none";
  }

  setCell(nodeId: string, x: number, y: number) {
    if (!this.cells.has(nodeId)) {
      this.cells.set(nodeId, {
        nodeId,
        x,
        y,
        currentAlpha: FOG_UNREVEALED,
        targetAlpha: FOG_UNREVEALED,
      });
      this.dirty = true;
    }
  }

  updateVisibility(
    visitedRooms: Set<string>,
    adjacencyMap: Map<string, string[]>,
  ) {
    for (const cell of this.cells.values()) {
      if (visitedRooms.has(cell.nodeId)) {
        cell.targetAlpha = FOG_REVEALED;
      } else {
        const neighbors = adjacencyMap.get(cell.nodeId);
        if (neighbors && neighbors.some((n) => visitedRooms.has(n))) {
          cell.targetAlpha = FOG_ADJACENT;
        } else {
          cell.targetAlpha = FOG_UNREVEALED;
        }
      }
    }
    this.dirty = true;
  }

  tick(dt: number) {
    let anyChanged = false;
    for (const cell of this.cells.values()) {
      const diff = cell.targetAlpha - cell.currentAlpha;
      if (Math.abs(diff) > 0.001) {
        cell.currentAlpha += diff * FOG_FADE_SPEED * dt;
        cell.currentAlpha = Math.max(0, Math.min(1, cell.currentAlpha));
        anyChanged = true;
      }
    }
    if (anyChanged) {
      this.dirty = true;
    }
    if (this.dirty) {
      this.redraw();
    }
  }

  private redraw() {
    this.clear();
    for (const cell of this.cells.values()) {
      if (cell.currentAlpha > 0.01) {
        this.roundRect(
          cell.x - ROOM_WIDTH / 2 - 20,
          cell.y - ROOM_HEIGHT / 2 - 20,
          ROOM_WIDTH + 40,
          ROOM_HEIGHT + 40,
          8,
        ).fill({ color: FOG_COLOR, alpha: cell.currentAlpha });
      }
    }
    this.dirty = false;
  }
}
