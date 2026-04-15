/**
 * 32x32 pixel art character data for dungeon agents.
 * Each pixel is [x, y, colorHex]. Only non-transparent pixels are stored (sparse).
 * Characters are drawn at 2x scale (64x64 visual) via CharacterRenderer.
 *
 * Color palette per role uses 4 shades: dark, base, light, highlight.
 */

export type PixelFrame = Array<[x: number, y: number, color: number]>;

export interface CharacterData {
  idle: PixelFrame[];     // 2 frames (breathing)
  walk: PixelFrame[];     // 4 frames (leg movement)
  action: PixelFrame[];   // 2 frames (tool use)
  blocked: PixelFrame[];  // 2 frames (struggling)
}

// Color palettes per role: [dark, base, light, skin, eye]
const PAL = {
  warrior: { dark: 0x3a5a82, base: 0x5b8abf, light: 0x7da8d4, skin: 0xd4a574, eye: 0x1a1a2e },
  rogue:   { dark: 0x823a3a, base: 0xbf6b5b, light: 0xd48a7d, skin: 0xd4a574, eye: 0x1a1a2e },
  mage:    { dark: 0x5a3a82, base: 0x8b6baf, light: 0xa88bd4, skin: 0xd4a574, eye: 0x1a1a2e },
  ranger:  { dark: 0x3a823a, base: 0x5baf7b, light: 0x7dd49a, skin: 0xd4a574, eye: 0x1a1a2e },
  cleric:  { dark: 0x827a3a, base: 0xbfa85b, light: 0xd4c27d, skin: 0xd4a574, eye: 0x1a1a2e },
  bard:    { dark: 0x5a6470, base: 0x8b9aab, light: 0xabb8c8, skin: 0xd4a574, eye: 0x1a1a2e },
};

// Helper: fill a rectangle with pixels
function rect(x: number, y: number, w: number, h: number, color: number): PixelFrame {
  const pixels: PixelFrame = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      pixels.push([x + dx, y + dy, color]);
    }
  }
  return pixels;
}

// Helper: draw a line of pixels
function hline(x: number, y: number, w: number, color: number): PixelFrame {
  const pixels: PixelFrame = [];
  for (let dx = 0; dx < w; dx++) pixels.push([x + dx, y, color]);
  return pixels;
}

function vline(x: number, y: number, h: number, color: number): PixelFrame {
  const pixels: PixelFrame = [];
  for (let dy = 0; dy < h; dy++) pixels.push([x, y + dy, color]);
  return pixels;
}

function pixel(x: number, y: number, color: number): PixelFrame {
  return [[x, y, color]];
}

// ============================================================
// WARRIOR — armored figure with sword and shield
// ============================================================
function makeWarrior(): CharacterData {
  const p = PAL.warrior;

  function base(legOffset: number, armR: number): PixelFrame {
    return [
      // Helmet (rows 3-7)
      ...hline(13, 3, 6, p.light),     // helmet top highlight
      ...rect(12, 4, 8, 2, p.base),    // helmet body
      ...hline(12, 6, 8, p.dark),      // helmet brim
      // Visor slit
      ...pixel(14, 5, p.eye), ...pixel(17, 5, p.eye),
      // Face (row 7)
      ...hline(13, 7, 6, p.skin),
      // Neck
      ...hline(14, 8, 4, p.skin),
      // Shoulders + armor (rows 9-11)
      ...rect(10, 9, 12, 1, p.base),   // shoulder plate
      ...rect(11, 10, 10, 2, p.base),  // chest
      ...hline(13, 10, 6, p.light),    // chest highlight
      // Belt
      ...hline(12, 12, 8, p.dark),
      // Torso lower
      ...rect(12, 13, 8, 2, p.base),
      // Arms
      ...vline(10, 10, 4 + armR, p.base),  // left arm
      ...vline(21, 10, 4, p.base),          // right arm
      // Shield on left
      ...rect(8, 10, 2, 5, p.dark),
      ...pixel(9, 11, p.light),
      // Sword on right
      ...vline(22, 9, 6, 0xc0c0c0),   // blade
      ...pixel(22, 8, 0xe0e0e0),      // tip
      ...pixel(22, 15, p.dark),        // pommel
      // Legs (rows 15-22)
      ...rect(13, 15, 3, 7 + legOffset, p.dark),   // left leg
      ...rect(17, 15, 3, 7 - legOffset, p.dark),   // right leg
      // Boots
      ...hline(12, 22 + legOffset, 4, p.dark),     // left boot
      ...hline(17, 22 - legOffset, 4, p.dark),     // right boot
    ];
  }

  return {
    idle: [base(0, 0), base(0, 1)],
    walk: [base(0, 0), base(1, 0), base(0, 0), base(-1, 0)],
    action: [
      // Sword raised
      [...base(0, 0), ...vline(22, 5, 4, 0xe0e0e0), ...pixel(22, 4, 0xffffff)],
      base(0, 0),
    ],
    blocked: [
      [...base(0, 0), ...pixel(9, 12, 0xbf6b5b), ...pixel(10, 12, 0xbf6b5b)],
      [...base(0, 1), ...pixel(8, 11, 0xbf6b5b), ...pixel(9, 11, 0xbf6b5b)],
    ],
  };
}

// ============================================================
// ROGUE — hooded figure with daggers
// ============================================================
function makeRogue(): CharacterData {
  const p = PAL.rogue;

  function base(legOffset: number, cloakWave: number): PixelFrame {
    return [
      // Hood (rows 2-6)
      ...hline(13, 2, 6, p.dark),
      ...rect(12, 3, 8, 2, p.dark),
      ...hline(12, 5, 8, p.base),      // hood edge
      // Face peeking from hood
      ...hline(13, 5, 6, p.skin),
      ...pixel(14, 4, p.eye), ...pixel(17, 4, p.eye),
      // Neck
      ...hline(14, 6, 4, p.skin),
      // Cape/cloak (rows 7-20)
      ...rect(11 + cloakWave, 7, 10, 1, p.dark),
      ...rect(11, 8, 10, 6, p.dark),
      ...hline(13, 8, 6, p.base),      // tunic front
      ...rect(12, 9, 8, 3, p.base),    // body
      // Belt with buckle
      ...hline(12, 12, 8, 0x4a3a2a),
      ...pixel(16, 12, 0xc0a040),      // buckle
      // Arms
      ...vline(10, 8, 5, p.dark),      // left arm
      ...vline(21, 8, 5, p.dark),      // right arm
      // Daggers
      ...vline(9, 11, 3, 0xc0c0c0),   // left dagger
      ...vline(22, 11, 3, 0xc0c0c0),  // right dagger
      ...pixel(9, 14, p.dark),         // handle
      ...pixel(22, 14, p.dark),        // handle
      // Legs (rows 13-22)
      ...rect(13, 13, 3, 8 + legOffset, p.base),
      ...rect(17, 13, 3, 8 - legOffset, p.base),
      // Cape trail
      ...vline(11 - cloakWave, 14, 6, p.dark),
      ...vline(20 + cloakWave, 14, 6, p.dark),
      // Boots
      ...hline(12, 21 + legOffset, 4, 0x3a2a1a),
      ...hline(17, 21 - legOffset, 4, 0x3a2a1a),
    ];
  }

  return {
    idle: [base(0, 0), base(0, 1)],
    walk: [base(1, 0), base(0, 1), base(-1, 0), base(0, -1)],
    action: [
      [...base(0, 0), ...hline(22, 10, 3, 0xe0e0e0)],  // dagger thrust right
      base(0, 0),
    ],
    blocked: [
      [...base(0, 0), ...pixel(16, 3, 0xbf6b5b)],
      [...base(0, 1), ...pixel(15, 3, 0xbf6b5b)],
    ],
  };
}

// ============================================================
// MAGE — robed figure with pointed hat and staff
// ============================================================
function makeMage(): CharacterData {
  const p = PAL.mage;

  function base(legOffset: number, orbGlow: number): PixelFrame {
    return [
      // Pointed hat (rows 0-6)
      ...pixel(16, 0, p.light),
      ...hline(15, 1, 2, p.base),
      ...hline(14, 2, 4, p.base),
      ...hline(13, 3, 6, p.base),
      ...hline(12, 4, 8, p.dark),      // hat brim
      // Face (rows 5-7)
      ...rect(13, 5, 6, 2, p.skin),
      ...pixel(14, 5, p.eye), ...pixel(17, 5, p.eye),
      // Beard
      ...hline(14, 7, 4, 0xa0a0a0),
      ...hline(15, 8, 2, 0xa0a0a0),
      // Robe (rows 8-20)
      ...rect(11, 8, 10, 2, p.base),   // shoulders
      ...hline(13, 8, 6, p.light),     // collar
      ...rect(11, 10, 10, 6, p.base),  // body
      ...hline(12, 12, 8, p.dark),     // sash
      ...rect(11, 16, 10, 5, p.base),  // robe lower
      // Robe flare at bottom
      ...hline(10, 21, 12, p.dark),
      // Arms in robe
      ...vline(10, 9, 6, p.dark),
      ...vline(21, 9, 6, p.dark),
      // Staff (left side)
      ...vline(8, 2, 20, 0x6a4a2a),   // staff shaft
      ...pixel(8, 1, 0x6a4a2a),
      // Staff orb
      ...pixel(7, 1, orbGlow > 0 ? p.light : p.base),
      ...pixel(8, 0, orbGlow > 0 ? p.light : p.base),
      ...pixel(9, 1, orbGlow > 0 ? p.light : p.base),
      // Legs hidden by robe, just feet showing
      ...hline(12 + legOffset, 22, 3, p.dark),   // left foot
      ...hline(17 - legOffset, 22, 3, p.dark),   // right foot
    ];
  }

  return {
    idle: [base(0, 0), base(0, 1)],
    walk: [base(1, 0), base(0, 1), base(-1, 0), base(0, 0)],
    action: [
      // Staff glow
      [...base(0, 1), ...pixel(7, 0, 0xffffff), ...pixel(9, 0, 0xffffff)],
      base(0, 0),
    ],
    blocked: [
      [...base(0, 0), ...pixel(8, 0, 0xbf6b5b)],
      [...base(0, 1), ...pixel(8, 0, 0xbf6b5b)],
    ],
  };
}

// ============================================================
// RANGER — cloaked figure with bow
// ============================================================
function makeRanger(): CharacterData {
  const p = PAL.ranger;

  function base(legOffset: number, bowDraw: number): PixelFrame {
    return [
      // Hood (rows 3-6)
      ...hline(13, 3, 6, p.dark),
      ...rect(12, 4, 8, 2, p.base),
      // Face
      ...hline(13, 5, 6, p.skin),
      ...pixel(14, 4, p.eye), ...pixel(17, 4, p.eye),
      // Neck
      ...hline(14, 6, 4, p.skin),
      // Cloak + tunic (rows 7-14)
      ...rect(11, 7, 10, 2, p.dark),   // shoulders/cloak
      ...rect(12, 9, 8, 4, p.base),    // tunic
      ...hline(12, 11, 8, p.dark),     // belt
      ...pixel(16, 11, 0xc0a040),      // buckle
      // Arms
      ...vline(10, 8, 5, p.dark),      // left arm
      ...vline(21, 8, 4, p.base),      // right arm (bow arm)
      // Bow on right
      ...vline(23, 7, 8 + bowDraw, 0x6a4a2a),  // bow stave
      ...pixel(23, 6, 0x6a4a2a),
      ...pixel(24, 8, 0xa0a0a0),       // string
      ...pixel(24, 12, 0xa0a0a0),      // string
      // Quiver on back (left side)
      ...vline(9, 7, 6, 0x4a3a2a),
      ...pixel(9, 6, 0xc0c0c0),       // arrow tip
      ...pixel(9, 5, 0xc0c0c0),
      // Legs (rows 13-21)
      ...rect(13, 13, 3, 7 + legOffset, p.dark),
      ...rect(17, 13, 3, 7 - legOffset, p.dark),
      // Boots
      ...hline(12, 20 + legOffset, 4, 0x4a3a2a),
      ...hline(17, 20 - legOffset, 4, 0x4a3a2a),
      // Cloak trailing
      ...vline(11, 14, 5, p.dark),
    ];
  }

  return {
    idle: [base(0, 0), base(0, 1)],
    walk: [base(1, 0), base(0, 0), base(-1, 0), base(0, 1)],
    action: [
      base(0, 2),  // bow drawn
      base(0, 0),  // released
    ],
    blocked: [
      [...base(0, 0), ...pixel(23, 10, 0xbf6b5b)],
      [...base(0, 1), ...pixel(23, 10, 0xbf6b5b)],
    ],
  };
}

// ============================================================
// CLERIC — hooded figure with glowing staff and shield emblem
// ============================================================
function makeCleric(): CharacterData {
  const p = PAL.cleric;

  function base(legOffset: number, glowing: number): PixelFrame {
    return [
      // Hood (rows 3-6)
      ...hline(13, 3, 6, p.base),
      ...rect(12, 4, 8, 2, p.base),
      ...hline(12, 6, 8, p.dark),      // hood rim
      // Face
      ...hline(13, 5, 6, p.skin),
      ...pixel(14, 4, p.eye), ...pixel(17, 4, p.eye),
      // Neck
      ...hline(14, 7, 4, p.skin),
      // Robe (rows 8-20)
      ...rect(11, 8, 10, 2, p.base),   // shoulders
      ...hline(14, 8, 4, p.light),     // holy symbol on chest
      ...pixel(16, 9, 0xffffff),       // cross center
      ...pixel(15, 9, p.light), ...pixel(17, 9, p.light),  // cross arms
      ...pixel(16, 8, p.light),        // cross top
      ...pixel(16, 10, p.light),       // cross bottom
      ...rect(11, 10, 10, 6, p.base),  // body
      ...hline(12, 12, 8, p.light),    // golden sash
      ...rect(11, 16, 10, 5, p.base),  // robe lower
      ...hline(10, 21, 12, p.dark),    // robe hem
      // Arms
      ...vline(10, 9, 5, p.base),      // left arm
      ...vline(21, 9, 5, p.base),      // right arm
      // Staff (right side)
      ...vline(23, 3, 18, 0x6a4a2a),
      // Staff glow cross at top
      ...pixel(23, 2, glowing > 0 ? 0xffffff : p.light),
      ...pixel(22, 3, glowing > 0 ? p.light : p.base),
      ...pixel(24, 3, glowing > 0 ? p.light : p.base),
      // Feet
      ...hline(12 + legOffset, 22, 3, p.dark),
      ...hline(17 - legOffset, 22, 3, p.dark),
    ];
  }

  return {
    idle: [base(0, 0), base(0, 1)],
    walk: [base(1, 0), base(0, 1), base(-1, 0), base(0, 0)],
    action: [
      base(0, 1),  // healing glow
      base(0, 0),
    ],
    blocked: [
      [...base(0, 0), ...pixel(23, 2, 0xbf6b5b)],
      [...base(0, 1), ...pixel(23, 2, 0xbf6b5b)],
    ],
  };
}

// ============================================================
// BARD — figure with feathered hat and lute
// ============================================================
function makeBard(): CharacterData {
  const p = PAL.bard;

  function base(legOffset: number, strumPos: number): PixelFrame {
    return [
      // Feathered hat (rows 2-6)
      ...hline(13, 3, 7, p.base),
      ...rect(12, 4, 8, 2, p.base),
      // Feather
      ...pixel(20, 3, 0x5baf7b),
      ...pixel(20, 2, 0x5baf7b),
      ...pixel(21, 1, 0x5baf7b),
      // Face
      ...hline(13, 5, 6, p.skin),
      ...pixel(14, 4, p.eye), ...pixel(17, 4, p.eye),
      // Smile
      ...pixel(15, 6, p.skin), ...pixel(16, 6, p.skin),
      // Neck
      ...hline(14, 7, 4, p.skin),
      // Tunic (rows 8-14)
      ...rect(11, 8, 10, 2, p.base),
      ...hline(14, 8, 4, p.light),     // collar
      ...rect(11, 10, 10, 4, p.base),  // body
      ...hline(12, 12, 8, p.dark),     // belt
      // Arms
      ...vline(10, 8, 4, p.base),      // left arm
      ...vline(21, 8, 3 + strumPos, p.base),  // right arm (strumming)
      // Lute (held in front-left)
      ...rect(7, 11, 3, 4, 0x6a4a2a), // lute body
      ...pixel(8, 10, 0x6a4a2a),      // neck
      ...pixel(8, 9, 0x6a4a2a),       // head
      ...pixel(8, 12, 0x4a3a2a),      // sound hole
      // Strings
      ...vline(8, 10, 4, 0xc0c0c0),
      // Legs (rows 14-21)
      ...rect(13, 14, 3, 7 + legOffset, p.base),
      ...rect(17, 14, 3, 7 - legOffset, p.base),
      // Boots
      ...hline(12, 21 + legOffset, 4, 0x4a3a2a),
      ...hline(17, 21 - legOffset, 4, 0x4a3a2a),
      // Cape
      ...vline(20, 8, 8, p.dark),
    ];
  }

  return {
    idle: [base(0, 0), base(0, 1)],
    walk: [base(1, 0), base(0, 0), base(-1, 0), base(0, 1)],
    action: [
      base(0, 1),  // strumming up
      base(0, -1), // strumming down
    ],
    blocked: [
      [...base(0, 0), ...pixel(8, 9, 0xbf6b5b)],
      [...base(0, 1), ...pixel(8, 9, 0xbf6b5b)],
    ],
  };
}

// Build all characters
export const CHARACTERS: Record<string, CharacterData> = {
  warrior: makeWarrior(),
  rogue: makeRogue(),
  mage: makeMage(),
  ranger: makeRanger(),
  cleric: makeCleric(),
  bard: makeBard(),
};
