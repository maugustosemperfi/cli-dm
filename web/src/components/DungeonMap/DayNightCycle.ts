import { Graphics } from "pixi.js";

const CYCLE_FRAMES = 36000;
const MAX_DARKNESS = 0.35;
const OVERLAY_COLOR = 0x0a0a1a;

export class DayNightCycle extends Graphics {
  private time = 0;
  private currentAlpha = 0;

  constructor(_width: number, _height: number) {
    super();
    this.eventMode = "none";
    this.clear().rect(-4000, -4000, 8000, 8000).fill({ color: OVERLAY_COLOR, alpha: 0 });
  }

  tick(dt: number): void {
    this.time += dt;
    const phase = (this.time % CYCLE_FRAMES) / CYCLE_FRAMES;
    this.currentAlpha =
      MAX_DARKNESS * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
    this.clear()
      .rect(-4000, -4000, 8000, 8000)
      .fill({ color: OVERLAY_COLOR, alpha: this.currentAlpha });
  }

  getNightMultiplier(): number {
    return 1.0 + 1.5 * (this.currentAlpha / MAX_DARKNESS);
  }

  isNight(): boolean {
    return this.currentAlpha > MAX_DARKNESS * 0.5;
  }
}
