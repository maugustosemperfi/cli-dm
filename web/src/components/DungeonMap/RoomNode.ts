import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { NodeStatus } from "../../protocol/events";
import { THEME, ROOM_WIDTH, ROOM_HEIGHT, statusColor, AGENT_HEX } from "./theme";
import type { RoomMetrics, MapLayer } from "../../stores/gameState";

const ROOF_H = 28;
const W = ROOM_WIDTH;
const H = ROOM_HEIGHT;

// ── Building System ──────────────────────────────────────────────────────────

const BUILDING_NAMES: Record<string, string[]> = {
  warrior: ["Guard Post", "Barracks", "Fortress", "Citadel"],
  rogue:   ["Hideout", "Tavern", "Den", "Guild"],
  mage:    ["Study", "Tower", "Spire", "Sanctum"],
  ranger:  ["Shelter", "Lodge", "Outpost", "Keep"],
  cleric:  ["Shrine", "Chapel", "Temple", "Cathedral"],
  bard:    ["Campfire", "Stage", "Theater", "Grand Theater"],
};
const CAVERN_NAMES = ["Crack", "Cavern", "Deep Cavern", "Crystal Cave"];

function getBuildingName(role: string, tier: number): string {
  return (BUILDING_NAMES[role] ?? CAVERN_NAMES)[tier - 1] ?? "Cavern";
}

// Wall base colors per building type (subtle role tints on the dark theme)
const WALL_COLORS: Record<string, number> = {
  warrior: 0x363a42,
  mage:    0x332d3e,
  rogue:   0x3a3228,
  ranger:  0x2e3628,
  cleric:  0x3a382d,
  bard:    0x33282e,
};
const CAVERN_WALL = 0x2a2c30;

// Lighter shade for window glow when active
function windowGlow(active: boolean, accent: number): { color: number; alpha: number } {
  return active
    ? { color: 0xffa54f, alpha: 0.55 }  // warm candlelight
    : { color: accent, alpha: 0.06 };
}

// ── Building draw functions ──────────────────────────────────────────────────

function drawFortress(gfx: Graphics, tier: number, accent: number, active: boolean) {
  const wall = WALL_COLORS.warrior;

  // Crenellated top
  const merlons = tier + 2;
  const merlonW = W / (merlons * 2);
  const battleH = ROOF_H * 0.55;
  // Battlement walkway
  gfx.rect(0, -6, W, 8).fill({ color: wall });
  // Merlons
  for (let i = 0; i < merlons; i++) {
    const mx = (i * 2 + 0.5) * merlonW;
    gfx.rect(mx, -battleH, merlonW, battleH - 4).fill({ color: wall });
  }
  // Corner towers at tier 3+
  if (tier >= 3) {
    gfx.rect(0, -battleH - 6, 10, battleH + 10).fill({ color: wall });
    gfx.rect(W - 10, -battleH - 6, 10, battleH + 10).fill({ color: wall });
  }

  // Main wall body
  gfx.rect(0, 0, W, H).fill({ color: wall });

  // Stone block texture
  for (let row = 0; row < 4; row++) {
    const y = 8 + row * 16;
    gfx.moveTo(0, y).lineTo(W, y).stroke({ color: 0x2e3038, width: 0.5, alpha: 0.5 });
    const off = row % 2 === 0 ? 0 : 22;
    for (let x = off; x < W; x += 44) {
      gfx.moveTo(x, y).lineTo(x, y + 16).stroke({ color: 0x2e3038, width: 0.5, alpha: 0.3 });
    }
  }

  // Arrow-slit windows
  const wg = windowGlow(active, accent);
  const winCount = tier + 1;
  const winSpacing = W / (winCount + 1);
  for (let i = 1; i <= winCount; i++) {
    gfx.rect(i * winSpacing - 2, 12, 4, 14).fill({ color: 0x1a1c1e });
    gfx.rect(i * winSpacing - 1, 13, 2, 12).fill(wg);
  }

  // Arched gate
  const dw = 20 + tier * 2;
  const dh = 30;
  const dx = (W - dw) / 2;
  const dy = H - dh;
  gfx.rect(dx, dy, dw, dh).fill({ color: 0x1e1f22 });
  gfx.ellipse(dx + dw / 2, dy, dw / 2, 8).fill({ color: 0x1e1f22 });
  // Gate frame accent
  gfx.rect(dx - 1, dy - 3, dw + 2, 3).fill({ color: accent, alpha: 0.25 });

  // Flag at tier 4
  if (tier >= 4) {
    const fx = W / 2;
    gfx.rect(fx - 1, -battleH - 14, 2, 14).fill({ color: 0x654321 });
    gfx.poly([fx + 1, -battleH - 14, fx + 12, -battleH - 9, fx + 1, -battleH - 4]).fill({ color: accent, alpha: 0.6 });
  }

  // Outline
  gfx.rect(0, 0, W, H).stroke({ color: 0x4a4d55, width: 1 });
}

function drawTower(gfx: Graphics, tier: number, accent: number, active: boolean) {
  const wall = WALL_COLORS.mage;
  const tw = W * 0.52;
  const tx = (W - tw) / 2;
  const cx = W / 2;

  // Pointed spire
  const spireH = ROOF_H * (0.8 + tier * 0.06);
  gfx.poly([cx, -spireH, tx - 3, 2, tx + tw + 3, 2]).fill({ color: wall });

  // Orb at tip
  gfx.circle(cx, -spireH - 3, 3).fill({ color: accent, alpha: 0.45 });
  gfx.circle(cx, -spireH - 3, 1.5).fill({ color: 0xffffff, alpha: 0.15 });

  // Tower body
  gfx.rect(tx, 0, tw, H).fill({ color: wall });

  // Round window
  const wy = 20;
  gfx.circle(cx, wy, 9).fill({ color: 0x1a1c1e });
  const wg = windowGlow(active, accent);
  gfx.circle(cx, wy, 7).fill(wg);
  gfx.moveTo(cx - 7, wy).lineTo(cx + 7, wy).stroke({ color: 0x3a3548, width: 1 });
  gfx.moveTo(cx, wy - 7).lineTo(cx, wy + 7).stroke({ color: 0x3a3548, width: 1 });

  // Door
  const dw = 14;
  const dh = 22;
  const dx = cx - dw / 2;
  gfx.rect(dx, H - dh, dw, dh).fill({ color: 0x1e1f22 });
  gfx.poly([dx, H - dh, cx, H - dh - 7, dx + dw, H - dh]).fill({ color: 0x1e1f22 });

  // Side turrets at tier 3+
  if (tier >= 3) {
    const stw = tw * 0.28;
    const sth = H * 0.45;
    gfx.rect(tx - stw, H - sth, stw, sth).fill({ color: wall });
    gfx.poly([tx - stw / 2, H - sth - 8, tx - stw - 2, H - sth, tx + 2, H - sth]).fill({ color: wall });
    gfx.rect(tx + tw, H - sth, stw, sth).fill({ color: wall });
    gfx.poly([tx + tw + stw / 2, H - sth - 8, tx + tw - 2, H - sth, tx + tw + stw + 2, H - sth]).fill({ color: wall });
  }

  // Rune dots at tier 4
  if (tier >= 4) {
    for (let i = 0; i < 3; i++) {
      const ry = 38 + i * 8;
      gfx.circle(tx + 6, ry, 1.5).fill({ color: accent, alpha: 0.3 });
      gfx.circle(tx + tw - 6, ry, 1.5).fill({ color: accent, alpha: 0.3 });
    }
  }

  // Outline
  gfx.rect(tx, 0, tw, H).stroke({ color: 0x4a3e55, width: 1 });
}

function drawTavern(gfx: Graphics, tier: number, accent: number, active: boolean) {
  const wall = WALL_COLORS.rogue;

  // Main body
  gfx.rect(0, 0, W, H).fill({ color: wall });

  // Peaked roof (A-frame)
  const peakY = -(ROOF_H * (0.6 + tier * 0.08));
  gfx.poly([W / 2, peakY, -6, 2, W + 6, 2]).fill({ color: 0x4a3828 });
  // Roof shingles
  for (let row = 0; row < 3; row++) {
    const ry = peakY + (2 - peakY) * (row + 1) / 4;
    const rx1 = W / 2 + ((-6 - W / 2) * (row + 1)) / 4;
    const rx2 = W / 2 + ((W + 6 - W / 2) * (row + 1)) / 4;
    gfx.moveTo(rx1, ry).lineTo(rx2, ry).stroke({ color: 0x3a2a1a, width: 0.5, alpha: 0.4 });
  }

  // Chimney at tier 3+
  if (tier >= 3) {
    gfx.rect(W * 0.75, peakY * 0.5, 12, -peakY * 0.5 + 4).fill({ color: 0x42382e });
    gfx.rect(W * 0.75 - 1, peakY * 0.5 - 2, 14, 3).fill({ color: 0x4a3e32 });
  }

  // Wood plank lines
  for (let row = 0; row < 5; row++) {
    const y = 6 + row * 13;
    gfx.moveTo(0, y).lineTo(W, y).stroke({ color: 0x2e2518, width: 0.5, alpha: 0.4 });
  }

  // Windows (square, warm-lit)
  const wg = windowGlow(active, accent);
  const winCount = tier === 1 ? 1 : 2;
  const winW = 14;
  const winH = 12;
  const winY = 14;
  if (winCount === 1) {
    const wx = W / 2 - winW / 2;
    gfx.rect(wx, winY, winW, winH).fill({ color: 0x1a1c1e });
    gfx.rect(wx + 1, winY + 1, winW - 2, winH - 2).fill(wg);
    gfx.moveTo(wx + winW / 2, winY).lineTo(wx + winW / 2, winY + winH).stroke({ color: 0x3a3228, width: 1 });
    gfx.moveTo(wx, winY + winH / 2).lineTo(wx + winW, winY + winH / 2).stroke({ color: 0x3a3228, width: 1 });
  } else {
    for (const wx of [W * 0.22 - winW / 2, W * 0.62 - winW / 2]) {
      gfx.rect(wx, winY, winW, winH).fill({ color: 0x1a1c1e });
      gfx.rect(wx + 1, winY + 1, winW - 2, winH - 2).fill(wg);
      gfx.moveTo(wx + winW / 2, winY).lineTo(wx + winW / 2, winY + winH).stroke({ color: 0x3a3228, width: 1 });
      gfx.moveTo(wx, winY + winH / 2).lineTo(wx + winW, winY + winH / 2).stroke({ color: 0x3a3228, width: 1 });
    }
  }

  // Wide door
  const dw = 22;
  const dh = 26;
  const dx = (W - dw) / 2;
  gfx.rect(dx, H - dh, dw, dh).fill({ color: 0x1e1f22 });
  gfx.moveTo(dx + dw / 2, H - dh).lineTo(dx + dw / 2, H).stroke({ color: 0x3a3228, width: 1 });
  // Door handle
  gfx.circle(dx + dw * 0.35, H - dh / 2, 1.5).fill({ color: 0xbfa85b, alpha: 0.5 });

  // Hanging sign at tier 2+
  if (tier >= 2) {
    const sx = W - 30;
    gfx.rect(sx + 6, 2, 2, 8).fill({ color: 0x654321 });
    gfx.rect(sx, 10, 14, 10).fill({ color: 0x4a3828 });
    gfx.rect(sx, 10, 14, 10).stroke({ color: 0x5a4838, width: 0.5 });
  }

  gfx.rect(0, 0, W, H).stroke({ color: 0x4a4035, width: 1 });
}

function drawLodge(gfx: Graphics, tier: number, accent: number, active: boolean) {
  const wall = WALL_COLORS.ranger;
  const overhang = 6 + tier * 2;

  // Main body
  gfx.rect(0, 0, W, H).fill({ color: wall });

  // Sloped roof with overhang
  const roofPeakY = -(ROOF_H * (0.5 + tier * 0.1));
  gfx.poly([
    W * 0.35, roofPeakY,
    W * 0.65, roofPeakY,
    W + overhang, 4,
    -overhang, 4,
  ]).fill({ color: 0x3a4a30 });
  // Ridge beam
  gfx.rect(W * 0.35, roofPeakY - 1, W * 0.3, 3).fill({ color: 0x654321, alpha: 0.5 });

  // Log lines (horizontal)
  for (let row = 0; row < 5; row++) {
    const y = 6 + row * 14;
    gfx.moveTo(0, y).lineTo(W, y).stroke({ color: 0x223018, width: 1, alpha: 0.4 });
    // Log end circles on edges
    gfx.circle(-1, y + 1, 2).fill({ color: 0x3a3228, alpha: 0.3 });
    gfx.circle(W + 1, y + 1, 2).fill({ color: 0x3a3228, alpha: 0.3 });
  }

  // Windows with shutters
  const wg = windowGlow(active, accent);
  const winW = 12;
  const winH = 10;
  for (const wx of [W * 0.25 - winW / 2, W * 0.75 - winW / 2]) {
    gfx.rect(wx, 16, winW, winH).fill({ color: 0x1a1c1e });
    gfx.rect(wx + 1, 17, winW - 2, winH - 2).fill(wg);
    // Shutters
    gfx.rect(wx - 3, 15, 3, winH + 2).fill({ color: 0x3a3228 });
    gfx.rect(wx + winW, 15, 3, winH + 2).fill({ color: 0x3a3228 });
  }

  // Wooden door
  const dw = 16;
  const dh = 24;
  const dx = (W - dw) / 2;
  gfx.rect(dx, H - dh, dw, dh).fill({ color: 0x3a2e1e });
  gfx.moveTo(dx, H - dh + 8).lineTo(dx + dw, H - dh + 8).stroke({ color: 0x2a2016, width: 0.5 });
  gfx.moveTo(dx, H - dh + 16).lineTo(dx + dw, H - dh + 16).stroke({ color: 0x2a2016, width: 0.5 });

  // Vine accents at tier 2+
  if (tier >= 2) {
    for (let i = 0; i < tier; i++) {
      const vx = 6 + i * 14;
      gfx.circle(vx, -2, 2).fill({ color: accent, alpha: 0.25 });
      gfx.circle(vx + 4, 1, 1.5).fill({ color: accent, alpha: 0.2 });
    }
  }

  gfx.rect(0, 0, W, H).stroke({ color: 0x3a4a30, width: 1 });
}

function drawTemple(gfx: Graphics, tier: number, accent: number, active: boolean) {
  const wall = WALL_COLORS.cleric;

  // Main body
  gfx.rect(0, 0, W, H).fill({ color: wall });

  // Dome roof (polygon arc)
  const segs = 8 + tier * 2;
  const domeH = ROOF_H * (0.7 + tier * 0.08);
  const pts: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const angle = Math.PI * (1 - i / segs);
    pts.push(W * 0.5 + (W * 0.52) * Math.cos(angle), -domeH * Math.sin(angle) + 2);
  }
  pts.push(W, 2, 0, 2);
  gfx.poly(pts).fill({ color: 0x4a4838 });

  // Cross/finial at tier 3+
  if (tier >= 3) {
    const cx = W / 2;
    gfx.rect(cx - 1.5, -domeH - 8, 3, 10).fill({ color: accent, alpha: 0.4 });
    gfx.rect(cx - 5, -domeH - 4, 10, 3).fill({ color: accent, alpha: 0.4 });
  }

  // Columns on sides
  const colW = 6;
  gfx.rect(4, 4, colW, H - 4).fill({ color: 0x4a4838 });
  gfx.rect(W - 4 - colW, 4, colW, H - 4).fill({ color: 0x4a4838 });
  if (tier >= 3) {
    gfx.rect(16, 4, colW, H - 4).fill({ color: 0x4a4838, alpha: 0.5 });
    gfx.rect(W - 16 - colW, 4, colW, H - 4).fill({ color: 0x4a4838, alpha: 0.5 });
  }

  // Tall arched windows (stained glass feel)
  const wg = windowGlow(active, accent);
  const winW = 10;
  const winH = 22;
  for (const wx of [W * 0.32, W * 0.68 - winW]) {
    gfx.rect(wx, 10, winW, winH).fill({ color: 0x1a1c1e });
    gfx.ellipse(wx + winW / 2, 10, winW / 2, 4).fill({ color: 0x1a1c1e });
    gfx.rect(wx + 1, 12, winW - 2, winH - 3).fill(wg);
    // Stained glass cross
    gfx.moveTo(wx + winW / 2, 10).lineTo(wx + winW / 2, 10 + winH).stroke({ color: 0x3a382d, width: 1 });
    gfx.moveTo(wx, 20).lineTo(wx + winW, 20).stroke({ color: 0x3a382d, width: 1 });
  }

  // Grand arched entrance
  const dw = 24;
  const dh = 32;
  const dx = (W - dw) / 2;
  const dy = H - dh;
  gfx.rect(dx, dy, dw, dh).fill({ color: 0x1e1f22 });
  gfx.ellipse(dx + dw / 2, dy, dw / 2, 10).fill({ color: 0x1e1f22 });
  // Golden doorstep
  gfx.rect(dx - 2, H - 3, dw + 4, 3).fill({ color: accent, alpha: 0.2 });

  gfx.rect(0, 0, W, H).stroke({ color: 0x4a4838, width: 1 });
}

function drawStage(gfx: Graphics, tier: number, accent: number, active: boolean) {
  const wall = WALL_COLORS.bard;

  // Stage floor (raised platform)
  gfx.rect(0, H * 0.75, W, H * 0.25).fill({ color: 0x3a2e22 });
  // Floor planks
  for (let i = 0; i < 6; i++) {
    const x = i * (W / 6);
    gfx.moveTo(x, H * 0.75).lineTo(x, H).stroke({ color: 0x2a2016, width: 0.5, alpha: 0.3 });
  }

  // Back wall (partial — stage is open front)
  gfx.rect(0, 0, W, H * 0.75).fill({ color: wall });

  // Columns on sides
  gfx.rect(2, 0, 8, H).fill({ color: 0x3a2e22 });
  gfx.rect(W - 10, 0, 8, H).fill({ color: 0x3a2e22 });

  // Curtain drape on top
  const waves = tier + 1;
  const waveW = W / waves;
  const curtainTop = -(ROOF_H * 0.6);
  // Curtain body (fills top)
  gfx.rect(0, curtainTop, W, -curtainTop + 4).fill({ color: 0x5a2030 });
  // Scalloped bottom edge
  for (let i = 0; i < waves; i++) {
    const cx = (i + 0.5) * waveW;
    const lx = i * waveW;
    const rx = (i + 1) * waveW;
    gfx.poly([lx, 2, cx, 14, rx, 2]).fill({ color: 0x5a2030 });
  }
  // Curtain rod
  gfx.rect(-4, curtainTop - 2, W + 8, 3).fill({ color: 0x654321 });
  // Tassels
  if (tier >= 2) {
    gfx.rect(-2, curtainTop, 4, 10).fill({ color: accent, alpha: 0.35 });
    gfx.rect(W - 2, curtainTop, 4, 10).fill({ color: accent, alpha: 0.35 });
  }

  // Spotlight glow when active
  const wg = windowGlow(active, accent);
  if (active) {
    gfx.circle(W / 2, H * 0.5, 20).fill({ color: wg.color, alpha: wg.alpha * 0.5 });
  }

  // Musical note decoration at tier 3+
  if (tier >= 3) {
    for (let i = 0; i < 2; i++) {
      const nx = 20 + i * (W - 40);
      gfx.circle(nx, 30, 3).fill({ color: accent, alpha: 0.25 });
      gfx.rect(nx + 2, 20, 1.5, 10).fill({ color: accent, alpha: 0.25 });
    }
  }

  gfx.rect(0, 0, W, H).stroke({ color: 0x4a3040, width: 1 });
}

function drawCavern(gfx: Graphics, tier: number, accent: number, active: boolean) {
  const wall = CAVERN_WALL;

  // Irregular cave walls — draw as polygon with jagged edges
  const leftEdge: number[] = [];
  const rightEdge: number[] = [];
  for (let y = -ROOF_H; y <= H; y += 8) {
    leftEdge.push(-3 + Math.sin(y * 0.15) * (4 + tier), y);
    rightEdge.push(W + 3 - Math.sin(y * 0.18 + 1) * (4 + tier), y);
  }
  // Build cave outline
  const cavePts: number[] = [];
  for (let i = 0; i < leftEdge.length; i += 2) cavePts.push(leftEdge[i], leftEdge[i + 1]);
  cavePts.push(leftEdge[leftEdge.length - 2], H);
  cavePts.push(rightEdge[rightEdge.length - 2], H);
  for (let i = rightEdge.length - 2; i >= 0; i -= 2) cavePts.push(rightEdge[i], rightEdge[i + 1]);
  gfx.poly(cavePts).fill({ color: wall });

  // Stalactites hanging from top
  const spikes = tier + 3;
  const spikeW = W / (spikes + 1);
  for (let i = 0; i < spikes; i++) {
    const sx = (i + 0.8) * spikeW;
    const depth = 8 + ((i * 7 + tier * 3) % 5) * 4;
    const sw = spikeW * 0.3;
    gfx.poly([sx - sw, -ROOF_H, sx + sw, -ROOF_H, sx + sw * 0.3, -ROOF_H + depth]).fill({ color: 0x3a3c40 });
  }

  // Stalagmites from bottom
  for (let i = 0; i < tier + 1; i++) {
    const sx = 15 + i * (W / (tier + 2));
    const h = 6 + (i * 5) % 8;
    gfx.poly([sx - 4, H, sx, H - h, sx + 4, H]).fill({ color: 0x3a3c40 });
  }

  // Glowing crystals instead of windows
  const wg = windowGlow(active, accent);
  const crystalCount = tier;
  for (let i = 0; i < crystalCount; i++) {
    const cx = W * (0.25 + i * 0.5 / Math.max(crystalCount - 1, 1));
    const cy = 18 + (i % 2) * 10;
    gfx.poly([cx, cy - 8, cx + 4, cy, cx, cy + 3, cx - 4, cy]).fill({ color: accent, alpha: active ? 0.45 : 0.15 });
    if (active) {
      gfx.circle(cx, cy - 2, 6).fill({ color: wg.color, alpha: 0.08 });
    }
  }

  // Cave mouth entrance
  const dw = 24 + tier * 2;
  const dh = 28;
  const dx = (W - dw) / 2;
  gfx.ellipse(dx + dw / 2, H - dh / 2, dw / 2, dh / 2).fill({ color: 0x1a1c1e });

  gfx.poly(cavePts).stroke({ color: 0x3a3c40, width: 1 });
}

// ── Activity glow color mapping ──────────────────────────────────────────────
function activityGlowColor(action: string): number | null {
  switch (action) {
    case "read":     return 0xbfa85b;
    case "edit":     return 0xd9893c;
    case "test":     return 0x5bafbf;
    case "build":    return 0xbfa85b;
    case "git":      return 0x5b8abf;
    case "thinking": return 0x8b6baf;
    case "blocked":  return 0xbf6b5b;
    case "error":    return 0xbf5046;
    default:         return null;
  }
}

// ── RoomNode ─────────────────────────────────────────────────────────────────

export class RoomNode extends Container {
  nodeId: string;
  private buildingGfx: Graphics;
  private buildingLabel: Text;
  private statusDot: Graphics;
  private labelText: Text;
  private assigneeText: Text;
  private glowGraphic: Graphics;
  private activityGlow: Graphics;
  private currentStatus: NodeStatus = "pending";
  private pulseTime = 0;
  private heatGlow: Graphics;
  private heatLevel = 0;
  private fireGlow: Graphics;
  private fireIntensity = 0;
  private fireEmbers: Array<{ x: number; y: number; vy: number; life: number; size: number }> = [];
  private currentRole = "";
  private currentTier = 1;
  private activityTime = 0;
  private isActive = false;
  private overlayGfx: Graphics;
  private overlayPulseTime = 0;
  private currentOverlayType: MapLayer = "default";

  constructor(nodeId: string, label: string, x: number, y: number) {
    super();
    this.nodeId = nodeId;
    this.position.set(x - W / 2, y - H / 2);
    this.eventMode = "static";
    this.cursor = "pointer";

    // Fire glow (outermost)
    this.fireGlow = new Graphics();
    this.fireGlow.alpha = 0;
    this.addChild(this.fireGlow);

    // Heat glow
    this.heatGlow = new Graphics();
    this.heatGlow.alpha = 0;
    this.addChild(this.heatGlow);

    // Selection glow
    this.glowGraphic = new Graphics();
    this.glowGraphic.alpha = 0;
    this.addChild(this.glowGraphic);

    // Activity glow
    this.activityGlow = new Graphics();
    this.activityGlow.alpha = 0;
    this.addChild(this.activityGlow);

    // Building (the main visual — replaces old bg + accent + roof)
    this.buildingGfx = new Graphics();
    this.addChild(this.buildingGfx);

    // Overlay layer (above building, below text)
    this.overlayGfx = new Graphics();
    this.overlayGfx.alpha = 0;
    this.addChild(this.overlayGfx);

    // Building type label (above building)
    this.buildingLabel = new Text({
      text: "",
      style: new TextStyle({ fontFamily: "monospace", fontSize: 8, fill: THEME.textMuted, letterSpacing: 1.5 }),
    });
    this.buildingLabel.alpha = 0.5;
    this.buildingLabel.anchor.set(0.5, 1);
    this.buildingLabel.position.set(W / 2, -ROOF_H - 4);
    this.addChild(this.buildingLabel);

    // Status dot (lantern at door)
    this.statusDot = new Graphics();
    this.statusDot.position.set(W / 2 - 16, H - 20);
    this.addChild(this.statusDot);

    // Label (task name)
    this.labelText = new Text({
      text: label.length > 18 ? label.slice(0, 17) + "..." : label,
      style: new TextStyle({ fontFamily: "monospace", fontSize: 13, fill: THEME.text }),
    });
    this.labelText.position.set(16, 14);
    this.addChild(this.labelText);

    // Assignee name
    this.assigneeText = new Text({
      text: "",
      style: new TextStyle({ fontFamily: "monospace", fontSize: 11, fill: THEME.textMuted }),
    });
    this.assigneeText.position.set(16, 38);
    this.addChild(this.assigneeText);

    this.drawBuilding(THEME.statusPending);
  }

  update(status: NodeStatus, assigneeName?: string, assigneeRole?: string, currentAction?: string) {
    this.currentStatus = status;
    const color = statusColor(status);
    const wasActive = this.isActive;
    this.isActive = !!currentAction && currentAction !== "idle";

    if (assigneeName) {
      this.assigneeText.text = assigneeName;
      if (assigneeRole && AGENT_HEX[assigneeRole] !== undefined) {
        this.assigneeText.style.fill = AGENT_HEX[assigneeRole];
      }
    }

    // Redraw building when role changes or activity changes (window glow)
    const roleChanged = assigneeRole && assigneeRole !== this.currentRole;
    if (roleChanged) this.currentRole = assigneeRole!;
    if (roleChanged || this.isActive !== wasActive) {
      this.drawBuilding(color);
    }

    // Status dot
    this.statusDot.clear();
    this.statusDot.circle(0, 0, 4).fill({ color });

    // Activity glow effect
    const glowColor = activityGlowColor(currentAction ?? "idle");
    if (glowColor) {
      this.activityGlow.clear();
      this.activityGlow
        .roundRect(-4, -ROOF_H - 4, W + 8, H + ROOF_H + 8, 6)
        .fill({ color: glowColor, alpha: 0.06 });
      this.activityGlow.alpha = 1;
    } else {
      this.activityGlow.alpha = 0;
    }
  }

  private drawBuilding(_statusColor: number) {
    this.buildingGfx.clear();
    const role = this.currentRole;
    const accent = AGENT_HEX[role] ?? 0x8b9aab;
    const tier = this.currentTier;
    const active = this.isActive;

    switch (role) {
      case "warrior": drawFortress(this.buildingGfx, tier, accent, active); break;
      case "mage":    drawTower(this.buildingGfx, tier, accent, active); break;
      case "rogue":   drawTavern(this.buildingGfx, tier, accent, active); break;
      case "ranger":  drawLodge(this.buildingGfx, tier, accent, active); break;
      case "cleric":  drawTemple(this.buildingGfx, tier, accent, active); break;
      case "bard":    drawStage(this.buildingGfx, tier, accent, active); break;
      default:        drawCavern(this.buildingGfx, tier, accent, active); break;
    }

    // Update label
    const name = getBuildingName(role || "cavern", tier);
    this.buildingLabel.text = name.toUpperCase();
    this.buildingLabel.style.fill = accent;
  }

  setTier(tier: number) {
    if (tier === this.currentTier) return;
    this.currentTier = tier;
    this.drawBuilding(statusColor(this.currentStatus));
  }

  highlight(on: boolean) {
    if (on) {
      this.glowGraphic.clear();
      this.glowGraphic
        .roundRect(-4, -ROOF_H - 4, W + 8, H + ROOF_H + 8, 8)
        .fill({ color: THEME.highlight, alpha: 0.15 })
        .stroke({ color: THEME.highlight, width: 2, alpha: 0.6 });
      this.glowGraphic.alpha = 1;
    } else {
      this.glowGraphic.alpha = 0;
    }
  }

  setHeat(heat: number) {
    const intensity = Math.min(1, heat / 50);
    if (Math.abs(intensity - this.heatLevel) < 0.01) return;
    this.heatLevel = intensity;
    this.heatGlow.clear();
    if (intensity > 0.05) {
      const color = intensity > 0.5 ? 0xbf6b5b : 0x5b8abf;
      this.heatGlow
        .roundRect(-6, -ROOF_H - 6, W + 12, H + ROOF_H + 12, 8)
        .fill({ color, alpha: intensity * 0.12 });
      this.heatGlow.alpha = 1;
    } else {
      this.heatGlow.alpha = 0;
    }
  }

  setFire(intensity: number) {
    if (intensity > this.fireIntensity) {
      for (let i = 0; i < 4; i++) {
        this.fireEmbers.push({
          x: Math.random() * W,
          y: H - Math.random() * 10,
          vy: -(0.5 + Math.random() * 1.5),
          life: 0.6 + Math.random() * 0.6,
          size: 1 + Math.random() * 2,
        });
      }
    }
    this.fireIntensity = Math.max(this.fireIntensity, intensity);
  }

  /** Set the map overlay for this room based on the active layer and metrics */
  setOverlay(layer: MapLayer, metrics: RoomMetrics | null, maxTokens: number, maxErrors: number) {
    this.currentOverlayType = layer;
    this.overlayGfx.clear();

    if (layer === "default" || !metrics) {
      this.overlayGfx.alpha = 0;
      return;
    }

    switch (layer) {
      case "cost": {
        // Green → yellow → red based on token count relative to max
        const ratio = maxTokens > 0 ? Math.min(1, metrics.totalTokens / maxTokens) : 0;
        const color = lerpHeatColor(ratio);
        this.overlayGfx.roundRect(0, 0, W, H, 4).fill({ color, alpha: 0.35 });
        this.overlayGfx.alpha = 1;
        break;
      }
      case "errors": {
        const ratio = maxErrors > 0 ? Math.min(1, metrics.errorCount / maxErrors) : 0;
        if (metrics.errorCount === 0) {
          this.overlayGfx.alpha = 0;
          return;
        }
        // White → orange → red
        const color = ratio < 0.5
          ? lerpColor(0xffffff, 0xff8c00, ratio * 2)
          : lerpColor(0xff8c00, 0xff0000, (ratio - 0.5) * 2);
        this.overlayGfx.roundRect(0, 0, W, H, 4).fill({ color, alpha: 0.3 });
        // Pulsing red border
        this.overlayGfx.roundRect(-2, -2, W + 4, H + 4, 6).stroke({ color: 0xff0000, width: 2, alpha: 0.5 });
        this.overlayGfx.alpha = 1;
        break;
      }
      case "activity": {
        // Alpha based on recency: bright = recent, dim = old
        const now = Date.now();
        const age = now - (metrics.lastActionTs || 0);
        const MAX_AGE = 120_000; // 2 minutes
        const recency = metrics.lastActionTs > 0 ? Math.max(0.15, 1 - age / MAX_AGE) : 0.1;
        this.overlayGfx.roundRect(0, 0, W, H, 4).fill({ color: 0x5b8abf, alpha: recency * 0.4 });
        this.overlayGfx.alpha = 1;
        break;
      }
      case "fog": {
        // Enhanced fog: unvisited dark, visited but inactive dim, active bright
        // Fog is handled by FogOfWar.ts; here we add recency-based brightness
        const now = Date.now();
        const age = now - (metrics.lastActionTs || 0);
        const isActive = age < 10_000;
        const isRecent = age < 60_000;
        if (isActive) {
          this.overlayGfx.roundRect(-2, -2, W + 4, H + 4, 6).fill({ color: 0xffa500, alpha: 0.08 });
        } else if (!isRecent && metrics.actionCount > 0) {
          this.overlayGfx.roundRect(0, 0, W, H, 4).fill({ color: 0x111115, alpha: 0.25 });
        }
        this.overlayGfx.alpha = 1;
        break;
      }
    }
  }

  tick(dt: number) {
    if (this.currentStatus === "in_progress") {
      this.pulseTime += dt * 0.03;
      this.statusDot.alpha = 0.6 + Math.sin(this.pulseTime) * 0.15;
    } else {
      this.statusDot.alpha = 1;
    }

    // Pulse activity glow
    if (this.activityGlow.alpha > 0) {
      this.activityTime += dt * 0.04;
      this.activityGlow.alpha = 0.6 + Math.sin(this.activityTime) * 0.4;
    }

    // Pulse overlay for activity and error layers
    if (this.overlayGfx.alpha > 0 && (this.currentOverlayType === "activity" || this.currentOverlayType === "errors")) {
      this.overlayPulseTime += dt * 0.03;
      this.overlayGfx.alpha = 0.7 + Math.sin(this.overlayPulseTime) * 0.3;
    }

    // Fire decay and ember animation
    if (this.fireIntensity > 0.01) {
      this.fireIntensity *= 0.997;
      this.fireGlow.clear();
      this.fireGlow
        .roundRect(-3, -ROOF_H - 3, W + 6, H + ROOF_H + 6, 6)
        .fill({ color: 0xbf6b5b, alpha: this.fireIntensity * 0.15 })
        .stroke({ color: 0xbf6b5b, width: 2, alpha: this.fireIntensity * 0.5 });
      for (let i = this.fireEmbers.length - 1; i >= 0; i--) {
        const e = this.fireEmbers[i];
        e.y += e.vy * dt * 0.5;
        e.life -= dt * 0.015;
        e.x += (Math.random() - 0.5) * dt * 0.3;
        if (e.life <= 0) {
          this.fireEmbers.splice(i, 1);
        } else {
          this.fireGlow
            .circle(e.x, e.y, e.size * e.life)
            .fill({ color: e.life > 0.4 ? 0xbf6b5b : 0xbfa85b, alpha: e.life * this.fireIntensity });
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
}

// ── Color utilities for overlays ────────────────────────────────────────────

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Green → Yellow → Red heatmap color based on 0-1 ratio */
function lerpHeatColor(ratio: number): number {
  if (ratio < 0.5) {
    return lerpColor(0x00ff00, 0xffff00, ratio * 2);
  }
  return lerpColor(0xffff00, 0xff0000, (ratio - 0.5) * 2);
}
