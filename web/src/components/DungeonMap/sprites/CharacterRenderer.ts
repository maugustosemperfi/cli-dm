import { Application, Graphics, Texture } from "pixi.js";
import { CHARACTERS, type PixelFrame, type CharacterData } from "./pixelData";

/** Each pixel in the sprite data is rendered at PIXEL_SIZE x PIXEL_SIZE screen pixels */
const PIXEL_SIZE = 2;

/** Total visual size of a character sprite */
export const CHAR_WIDTH = 32 * PIXEL_SIZE;
export const CHAR_HEIGHT = 32 * PIXEL_SIZE;

export type AnimState = "idle" | "walk" | "action" | "blocked";

/**
 * Pre-renders all pixel art frames into GPU textures on construction.
 * AgentSprite swaps textures each tick for animation.
 */
export class CharacterRenderer {
  private textures = new Map<string, Texture>();

  constructor(app: Application) {
    const gfx = new Graphics();

    for (const [role, data] of Object.entries(CHARACTERS)) {
      for (const [anim, frames] of Object.entries(data as CharacterData)) {
        for (let i = 0; i < (frames as PixelFrame[]).length; i++) {
          const frame = (frames as PixelFrame[])[i];
          gfx.clear();
          this.drawFrame(gfx, frame);

          const texture = app.renderer.generateTexture({
            target: gfx,
            resolution: 1,
          });
          this.textures.set(key(role, anim as AnimState, i), texture);
        }
      }
    }

    gfx.destroy();
  }

  getTexture(role: string, anim: AnimState, frame: number): Texture {
    const k = key(role, anim, frame);
    return this.textures.get(k) ?? Texture.EMPTY;
  }

  getFrameCount(role: string, anim: AnimState): number {
    const data = CHARACTERS[role];
    if (!data) return 1;
    const frames = data[anim];
    return frames ? frames.length : 1;
  }

  destroy() {
    for (const tex of this.textures.values()) {
      if (tex !== Texture.EMPTY) tex.destroy(true);
    }
    this.textures.clear();
  }

  private drawFrame(gfx: Graphics, frame: PixelFrame) {
    // Group pixels by color to batch draw calls
    const byColor = new Map<number, Array<[number, number]>>();
    for (const [x, y, color] of frame) {
      let arr = byColor.get(color);
      if (!arr) {
        arr = [];
        byColor.set(color, arr);
      }
      arr.push([x, y]);
    }

    for (const [color, pixels] of byColor) {
      for (const [x, y] of pixels) {
        gfx.rect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE)
          .fill({ color });
      }
    }
  }
}

function key(role: string, anim: AnimState, frame: number): string {
  return `${role}_${anim}_${frame}`;
}
