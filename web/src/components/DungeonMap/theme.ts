import type { NodeStatus } from "../../protocol/events";

export const THEME = {
  bg: 0x313338,
  roomFill: 0x2b2d31,
  roomStroke: 0x3f4147,
  roomStrokeActive: 0x5b8abf,
  corridorDefault: 0x3f4147,
  corridorActive: 0x5b8abf,
  corridorCompleted: 0x5baf7b,
  corridorBlocked: 0xbf6b5b,
  text: 0xdbdee1,
  textMuted: 0x8b9aab,
  gridDot: 0x3f4147,
  highlight: 0x5b8abf,

  statusPending: 0x4e5058,
  statusInProgress: 0x5b8abf,
  statusCompleted: 0x5baf7b,
  statusFailed: 0xbf6b5b,
  statusBlocked: 0xbfa85b,
} as const;

export const AGENT_HEX: Record<string, number> = {
  warrior: 0x5b8abf,
  rogue: 0xbf6b5b,
  mage: 0x8b6baf,
  ranger: 0x5baf7b,
  cleric: 0xbfa85b,
  bard: 0x8b9aab,
};

export function statusColor(status: NodeStatus): number {
  switch (status) {
    case "in_progress":
      return THEME.statusInProgress;
    case "completed":
      return THEME.statusCompleted;
    case "failed":
      return THEME.statusFailed;
    case "blocked":
      return THEME.statusBlocked;
    default:
      return THEME.statusPending;
  }
}

export const ROOM_WIDTH = 180;
export const ROOM_HEIGHT = 70;
export const LAYER_SPACING = 450;
export const NODE_SPACING = 220;
export const PADDING = 180;

// 2D grid layout spacing
export const GRID_COL_SPACING = 350;
export const GRID_ROW_SPACING = 250;

// Night palette — used by DayNightCycle for tinting
export const NIGHT_THEME = {
  torchGlow: 0xffa500,
  torchFlame: 0xff8c00,
  overlayColor: 0x0a0a1a,
  maxDarkness: 0.35,
  cycleDurationFrames: 36000,
} as const;
