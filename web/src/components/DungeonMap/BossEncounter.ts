import { Container, Graphics, Text, TextStyle } from "pixi.js";

export type BossType = "dragon" | "skeleton" | "golem";

const P = 2; // pixel scale

// --- Dragon (24x24) — red/orange, wings, horns ---
const DRAGON_PIXELS: Array<[number, number, number]> = [
  // horns
  [8, 2, 0xbf6b5b], [15, 2, 0xbf6b5b],
  [8, 3, 0xbf6b5b], [9, 3, 0xbf6b5b], [14, 3, 0xbf6b5b], [15, 3, 0xbf6b5b],
  // head
  [9, 4, 0xbf6b5b], [10, 4, 0xbf6b5b], [11, 4, 0xbf6b5b], [12, 4, 0xbf6b5b], [13, 4, 0xbf6b5b], [14, 4, 0xbf6b5b],
  [9, 5, 0xa85545], [10, 5, 0xbf6b5b], [11, 5, 0xbf6b5b], [12, 5, 0xbf6b5b], [13, 5, 0xbf6b5b], [14, 5, 0xa85545],
  // eyes
  [10, 5, 0xff3333], [13, 5, 0xff3333],
  // jaw
  [10, 6, 0xa85545], [11, 6, 0xa85545], [12, 6, 0xa85545], [13, 6, 0xa85545],
  // neck
  [10, 7, 0xbf6b5b], [11, 7, 0xbf6b5b], [12, 7, 0xbf6b5b], [13, 7, 0xbf6b5b],
  // left wing
  [2, 6, 0xa85545], [3, 6, 0xa85545], [4, 7, 0xa85545], [5, 7, 0xa85545],
  [3, 7, 0xa85545], [4, 8, 0xbf6b5b], [5, 8, 0xbf6b5b], [6, 8, 0xbf6b5b],
  [4, 9, 0xbf6b5b], [5, 9, 0xbf6b5b], [6, 9, 0xbf6b5b], [7, 9, 0xbf6b5b],
  // right wing
  [20, 6, 0xa85545], [21, 6, 0xa85545], [18, 7, 0xa85545], [19, 7, 0xa85545],
  [20, 7, 0xa85545], [17, 8, 0xbf6b5b], [18, 8, 0xbf6b5b], [19, 8, 0xbf6b5b],
  [16, 9, 0xbf6b5b], [17, 9, 0xbf6b5b], [18, 9, 0xbf6b5b], [19, 9, 0xbf6b5b],
  // body
  [8, 8, 0xbf6b5b], [9, 8, 0xbf6b5b], [10, 8, 0xa85545], [11, 8, 0xa85545], [12, 8, 0xa85545], [13, 8, 0xa85545], [14, 8, 0xbf6b5b], [15, 8, 0xbf6b5b],
  [8, 9, 0xbf6b5b], [9, 9, 0xa85545], [10, 9, 0xa85545], [11, 9, 0xa85545], [12, 9, 0xa85545], [13, 9, 0xa85545], [14, 9, 0xa85545], [15, 9, 0xbf6b5b],
  [8, 10, 0xbf6b5b], [9, 10, 0xa85545], [10, 10, 0xa85545], [11, 10, 0xbf6b5b], [12, 10, 0xbf6b5b], [13, 10, 0xa85545], [14, 10, 0xa85545], [15, 10, 0xbf6b5b],
  [9, 11, 0xbf6b5b], [10, 11, 0xa85545], [11, 11, 0xa85545], [12, 11, 0xa85545], [13, 11, 0xa85545], [14, 11, 0xbf6b5b],
  [9, 12, 0xbf6b5b], [10, 12, 0xbf6b5b], [11, 12, 0xbf6b5b], [12, 12, 0xbf6b5b], [13, 12, 0xbf6b5b], [14, 12, 0xbf6b5b],
  // belly
  [10, 11, 0xd49a6a], [11, 11, 0xd49a6a], [12, 11, 0xd49a6a], [13, 11, 0xd49a6a],
  // legs
  [9, 13, 0xa85545], [10, 13, 0xa85545], [13, 13, 0xa85545], [14, 13, 0xa85545],
  [9, 14, 0xa85545], [10, 14, 0xa85545], [13, 14, 0xa85545], [14, 14, 0xa85545],
  // tail
  [15, 12, 0xbf6b5b], [16, 12, 0xbf6b5b], [17, 13, 0xbf6b5b], [18, 13, 0xa85545],
];

// --- Skeleton (24x24) — bone white, sword ---
const SKELETON_PIXELS: Array<[number, number, number]> = [
  // skull
  [10, 3, 0xdbdee1], [11, 3, 0xdbdee1], [12, 3, 0xdbdee1], [13, 3, 0xdbdee1],
  [9, 4, 0xdbdee1], [10, 4, 0xdbdee1], [11, 4, 0xdbdee1], [12, 4, 0xdbdee1], [13, 4, 0xdbdee1], [14, 4, 0xdbdee1],
  [9, 5, 0xdbdee1], [10, 5, 0x222222], [11, 5, 0xdbdee1], [12, 5, 0xdbdee1], [13, 5, 0x222222], [14, 5, 0xdbdee1],
  // jaw
  [10, 6, 0xc4c7ca], [11, 6, 0x222222], [12, 6, 0x222222], [13, 6, 0xc4c7ca],
  // neck
  [11, 7, 0xc4c7ca], [12, 7, 0xc4c7ca],
  // ribcage
  [9, 8, 0xdbdee1], [10, 8, 0x222222], [11, 8, 0xdbdee1], [12, 8, 0xdbdee1], [13, 8, 0x222222], [14, 8, 0xdbdee1],
  [9, 9, 0xdbdee1], [10, 9, 0x222222], [11, 9, 0xdbdee1], [12, 9, 0xdbdee1], [13, 9, 0x222222], [14, 9, 0xdbdee1],
  [9, 10, 0xdbdee1], [10, 10, 0x222222], [11, 10, 0xdbdee1], [12, 10, 0xdbdee1], [13, 10, 0x222222], [14, 10, 0xdbdee1],
  // spine
  [11, 11, 0xc4c7ca], [12, 11, 0xc4c7ca],
  // pelvis
  [10, 12, 0xdbdee1], [11, 12, 0xdbdee1], [12, 12, 0xdbdee1], [13, 12, 0xdbdee1],
  // legs
  [10, 13, 0xc4c7ca], [13, 13, 0xc4c7ca],
  [10, 14, 0xc4c7ca], [13, 14, 0xc4c7ca],
  [10, 15, 0xc4c7ca], [13, 15, 0xc4c7ca],
  // arms
  [7, 8, 0xc4c7ca], [8, 8, 0xc4c7ca], [15, 8, 0xc4c7ca], [16, 8, 0xc4c7ca],
  [6, 9, 0xc4c7ca], [7, 9, 0xc4c7ca], [16, 9, 0xc4c7ca], [17, 9, 0xc4c7ca],
  // sword (right hand)
  [17, 7, 0x8b9aab], [17, 6, 0x8b9aab], [17, 5, 0x8b9aab], [17, 4, 0x8b9aab],
  [16, 7, 0x6d6f78], [18, 7, 0x6d6f78], // crossguard
];

// --- Golem (24x24) — stone gray, large ---
const GOLEM_PIXELS: Array<[number, number, number]> = [
  // head
  [9, 3, 0x6d6f78], [10, 3, 0x6d6f78], [11, 3, 0x6d6f78], [12, 3, 0x6d6f78], [13, 3, 0x6d6f78], [14, 3, 0x6d6f78],
  [8, 4, 0x6d6f78], [9, 4, 0x5c5e67], [10, 4, 0x5c5e67], [11, 4, 0x5c5e67], [12, 4, 0x5c5e67], [13, 4, 0x5c5e67], [14, 4, 0x5c5e67], [15, 4, 0x6d6f78],
  // eyes (glowing)
  [10, 4, 0xbfa85b], [13, 4, 0xbfa85b],
  [8, 5, 0x6d6f78], [9, 5, 0x5c5e67], [10, 5, 0x5c5e67], [11, 5, 0x5c5e67], [12, 5, 0x5c5e67], [13, 5, 0x5c5e67], [14, 5, 0x5c5e67], [15, 5, 0x6d6f78],
  // shoulders and body (wide)
  [5, 6, 0x6d6f78], [6, 6, 0x6d6f78], [7, 6, 0x6d6f78], [8, 6, 0x5c5e67], [9, 6, 0x5c5e67], [10, 6, 0x5c5e67],
  [11, 6, 0x5c5e67], [12, 6, 0x5c5e67], [13, 6, 0x5c5e67], [14, 6, 0x5c5e67], [15, 6, 0x5c5e67], [16, 6, 0x6d6f78], [17, 6, 0x6d6f78], [18, 6, 0x6d6f78],
  [5, 7, 0x6d6f78], [6, 7, 0x5c5e67], [7, 7, 0x5c5e67], [8, 7, 0x5c5e67], [9, 7, 0x5c5e67], [10, 7, 0x5c5e67],
  [11, 7, 0x5c5e67], [12, 7, 0x5c5e67], [13, 7, 0x5c5e67], [14, 7, 0x5c5e67], [15, 7, 0x5c5e67], [16, 7, 0x5c5e67], [17, 7, 0x5c5e67], [18, 7, 0x6d6f78],
  // torso
  [7, 8, 0x6d6f78], [8, 8, 0x5c5e67], [9, 8, 0x5c5e67], [10, 8, 0x5c5e67], [11, 8, 0x5c5e67], [12, 8, 0x5c5e67], [13, 8, 0x5c5e67], [14, 8, 0x5c5e67], [15, 8, 0x5c5e67], [16, 8, 0x6d6f78],
  [7, 9, 0x6d6f78], [8, 9, 0x5c5e67], [9, 9, 0x5c5e67], [10, 9, 0x5c5e67], [11, 9, 0x6d6f78], [12, 9, 0x6d6f78], [13, 9, 0x5c5e67], [14, 9, 0x5c5e67], [15, 9, 0x5c5e67], [16, 9, 0x6d6f78],
  [8, 10, 0x6d6f78], [9, 10, 0x5c5e67], [10, 10, 0x5c5e67], [11, 10, 0x5c5e67], [12, 10, 0x5c5e67], [13, 10, 0x5c5e67], [14, 10, 0x5c5e67], [15, 10, 0x6d6f78],
  [8, 11, 0x6d6f78], [9, 11, 0x5c5e67], [10, 11, 0x5c5e67], [11, 11, 0x5c5e67], [12, 11, 0x5c5e67], [13, 11, 0x5c5e67], [14, 11, 0x5c5e67], [15, 11, 0x6d6f78],
  // rune on chest
  [11, 8, 0xbfa85b], [12, 8, 0xbfa85b],
  // legs (thick)
  [8, 12, 0x6d6f78], [9, 12, 0x6d6f78], [10, 12, 0x6d6f78], [13, 12, 0x6d6f78], [14, 12, 0x6d6f78], [15, 12, 0x6d6f78],
  [8, 13, 0x5c5e67], [9, 13, 0x5c5e67], [10, 13, 0x5c5e67], [13, 13, 0x5c5e67], [14, 13, 0x5c5e67], [15, 13, 0x5c5e67],
  [8, 14, 0x5c5e67], [9, 14, 0x5c5e67], [10, 14, 0x5c5e67], [13, 14, 0x5c5e67], [14, 14, 0x5c5e67], [15, 14, 0x5c5e67],
  // arms
  [4, 7, 0x6d6f78], [5, 8, 0x6d6f78], [5, 9, 0x5c5e67], [5, 10, 0x5c5e67], [6, 10, 0x6d6f78],
  [19, 7, 0x6d6f78], [18, 8, 0x6d6f78], [18, 9, 0x5c5e67], [18, 10, 0x5c5e67], [17, 10, 0x6d6f78],
];

const BOSS_SPRITES: Record<BossType, Array<[number, number, number]>> = {
  dragon: DRAGON_PIXELS,
  skeleton: SKELETON_PIXELS,
  golem: GOLEM_PIXELS,
};

const BOSS_COLORS: Record<BossType, number> = {
  dragon: 0xbf6b5b,
  skeleton: 0xdbdee1,
  golem: 0x6d6f78,
};

const BOSS_NAMES: Record<BossType, string> = {
  dragon: "Firebreather",
  skeleton: "Bone Lord",
  golem: "Stone Guardian",
};

interface BossParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
}

interface DamageNumber {
  x: number;
  y: number;
  vy: number;
  value: number;
  life: number;
}

export class BossEncounter extends Container {
  private bossType: BossType;
  private bossGfx: Graphics;
  private healthBarBg: Graphics;
  private healthBarFill: Graphics;
  private slashGfx: Graphics;
  private particleGfx: Graphics;
  private shadowGfx: Graphics;
  private glowGfx: Graphics;
  private damageTexts: Text[] = [];
  private damageNumbers: DamageNumber[] = [];

  private time = 0;
  private health = 1; // 0..1
  private drainRate = 1 / (30 * 60); // deplete over ~30s at 60fps
  private resolving = false;
  private deathTimer = 0;
  private deathDuration = 60; // ~1s at 60fps
  private done = false;
  private attackTimer = 0;
  private attackInterval = 120; // every ~2s
  private particles: BossParticle[] = [];
  private bossColor: number;
  private bossNameText: Text;
  private hpText: Text;
  private enrageGlowGfx: Graphics;
  private damageFlashTimer = 0;
  private readonly maxHpDisplay = 100;

  constructor(x: number, y: number, bossType: BossType) {
    super();
    this.bossType = bossType;
    this.bossColor = BOSS_COLORS[bossType];
    this.position.set(x, y);

    // Glow behind boss
    this.glowGfx = new Graphics();
    this.addChild(this.glowGfx);

    // Shadow
    this.shadowGfx = new Graphics();
    this.shadowGfx.ellipse(24, 34, 18, 5).fill({ color: 0x000000, alpha: 0.3 });
    this.addChild(this.shadowGfx);

    // Boss sprite
    this.bossGfx = new Graphics();
    this.drawBoss();
    this.addChild(this.bossGfx);

    // Health bar background
    this.healthBarBg = new Graphics();
    this.healthBarBg.rect(-2, -12, 52, 6).fill({ color: 0x222222 });
    this.healthBarBg.rect(-2, -12, 52, 6).stroke({ color: 0x444444, width: 1 });
    this.addChild(this.healthBarBg);

    // Health bar fill
    this.healthBarFill = new Graphics();
    this.addChild(this.healthBarFill);

    // Boss name above health bar
    this.bossNameText = new Text({
      text: BOSS_NAMES[bossType],
      style: new TextStyle({ fontFamily: "monospace", fontSize: 8, fill: this.bossColor, fontWeight: "bold" }),
    });
    this.bossNameText.anchor.set(0.5, 1);
    this.bossNameText.position.set(24, -16);
    this.addChild(this.bossNameText);

    // HP text
    this.hpText = new Text({
      text: "100 / 100",
      style: new TextStyle({ fontFamily: "monospace", fontSize: 7, fill: 0xdbdee1 }),
    });
    this.hpText.anchor.set(0.5, 0);
    this.hpText.position.set(24, -4);
    this.addChild(this.hpText);

    // Enrage glow (behind everything)
    this.enrageGlowGfx = new Graphics();
    this.addChildAt(this.enrageGlowGfx, 0);

    // Slash effect layer
    this.slashGfx = new Graphics();
    this.addChild(this.slashGfx);

    // Particle layer
    this.particleGfx = new Graphics();
    this.addChild(this.particleGfx);

    this.updateHealthBar();
  }

  tick(dt: number): void {
    if (this.done) return;

    this.time += dt;
    if (this.damageFlashTimer > 0) this.damageFlashTimer -= dt;

    if (this.resolving) {
      this.tickDeath(dt);
      return;
    }

    // Drain health over time
    this.health = Math.max(0, this.health - this.drainRate * dt);
    this.updateHealthBar();

    if (this.health <= 0) {
      this.resolve();
      return;
    }

    // Boss idle animation
    if (this.bossType === "golem") {
      // Slow pulse scale
      const pulse = 1 + Math.sin(this.time * 0.03) * 0.02;
      this.bossGfx.scale.set(pulse, pulse);
    } else if (this.bossType === "dragon") {
      // Flame breath particles
      if (this.time % 20 < 1) {
        this.spawnFlameParticle();
      }
    }

    // Glow pulse
    this.glowGfx.clear();
    const glowAlpha = 0.1 + Math.sin(this.time * 0.04) * 0.05;
    this.glowGfx.circle(24, 16, 30).fill({ color: 0xbf6b5b, alpha: glowAlpha });

    // Attack timer (slash effects)
    this.attackTimer += dt;
    if (this.attackTimer >= this.attackInterval) {
      this.attackTimer = 0;
      this.spawnSlashEffect();
      this.spawnDamageNumber();
    }

    // Update slash
    this.tickSlash();

    // Update particles
    this.tickParticles(dt);

    // Update damage numbers
    this.tickDamageNumbers(dt);
  }

  resolve(): void {
    if (this.resolving) return;
    this.resolving = true;
    this.deathTimer = 0;

    // Spawn death particles
    for (let i = 0; i < 20; i++) {
      const angle = (Math.PI * 2 * i) / 20 + (Math.random() - 0.5) * 0.5;
      const speed = 1.5 + Math.random() * 3;
      this.particles.push({
        x: 24,
        y: 14,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: 40 + Math.random() * 20,
        maxLife: 40 + Math.random() * 20,
        color: this.bossColor,
        size: 2 + Math.random() * 3,
      });
    }
  }

  isDone(): boolean {
    return this.done;
  }

  private tickDeath(dt: number): void {
    this.deathTimer += dt;
    const progress = this.deathTimer / this.deathDuration;

    // Flash white
    if (progress < 0.3) {
      this.bossGfx.alpha = Math.sin(this.deathTimer * 0.8) > 0 ? 1 : 0.3;
      this.bossGfx.tint = 0xffffff;
    } else {
      this.bossGfx.alpha = Math.max(0, 1 - (progress - 0.3) * 2);
    }

    // Hide health bar
    this.healthBarBg.alpha = Math.max(0, 1 - progress * 3);
    this.healthBarFill.alpha = Math.max(0, 1 - progress * 3);
    this.glowGfx.alpha = Math.max(0, 1 - progress * 2);
    this.bossNameText.alpha = Math.max(0, 1 - progress * 3);
    this.hpText.alpha = Math.max(0, 1 - progress * 3);
    this.enrageGlowGfx.alpha = Math.max(0, 1 - progress * 2);

    this.tickParticles(dt);

    if (progress >= 1 && this.particles.every((p) => p.life <= 0)) {
      this.done = true;
    }
  }

  private drawBoss(): void {
    this.bossGfx.clear();
    const pixels = BOSS_SPRITES[this.bossType];
    for (const [x, y, color] of pixels) {
      this.bossGfx.rect(x * P, y * P, P, P).fill({ color });
    }
  }

  private updateHealthBar(): void {
    this.healthBarFill.clear();
    const barWidth = 48;
    const fillWidth = Math.max(0, barWidth * this.health);
    const color = this.health > 0.5 ? 0x5baf7b : this.health > 0.25 ? 0xbfa85b : 0xff3333;

    this.healthBarFill.rect(0, -10, fillWidth, 2).fill({ color });

    // Phase tick marks at 75%, 50%, 25%
    for (const pct of [0.75, 0.50, 0.25]) {
      const tx = barWidth * pct;
      this.healthBarFill.moveTo(tx, -12).lineTo(tx, -8).stroke({ color: 0x666666, width: 1, alpha: 0.6 });
    }

    // HP text
    const currentHP = Math.max(0, Math.round(this.health * this.maxHpDisplay));
    this.hpText.text = `${currentHP} / ${this.maxHpDisplay}`;

    // Damage flash
    if (this.damageFlashTimer > 0) {
      const flashAlpha = this.damageFlashTimer / 8;
      this.healthBarFill.rect(0, -10, fillWidth, 2).fill({ color: 0xffffff, alpha: flashAlpha * 0.5 });
    }

    // Enrage glow below 25%
    this.enrageGlowGfx.clear();
    if (this.health <= 0.25 && this.health > 0) {
      const pulseAlpha = 0.08 + Math.sin(this.time * 0.1) * 0.06;
      this.enrageGlowGfx.circle(24, 16, 35).fill({ color: 0xff3333, alpha: pulseAlpha });
    }
  }

  private spawnSlashEffect(): void {
    this.slashGfx.clear();
    // Diagonal slash mark
    const cx = 24 + (Math.random() - 0.5) * 20;
    const cy = 14 + (Math.random() - 0.5) * 10;
    this.slashGfx
      .moveTo(cx - 8, cy - 8)
      .lineTo(cx + 8, cy + 8)
      .stroke({ color: 0xffffff, width: 2, alpha: 0.8 });
    this.slashGfx
      .moveTo(cx - 6, cy - 10)
      .lineTo(cx + 10, cy + 6)
      .stroke({ color: 0xffff88, width: 1, alpha: 0.5 });
  }

  private tickSlash(): void {
    // Fade out slash over time
    if (this.slashGfx.alpha > 0) {
      this.slashGfx.alpha = Math.max(0, this.slashGfx.alpha - 0.04);
    }
    if (this.attackTimer < 5) {
      this.slashGfx.alpha = 1;
    }
  }

  private spawnDamageNumber(): void {
    const value = Math.floor(10 + Math.random() * 30);
    const dmg: DamageNumber = {
      x: 24 + (Math.random() - 0.5) * 20,
      y: -5,
      vy: -0.8,
      value,
      life: 40,
    };
    this.damageNumbers.push(dmg);
    this.damageFlashTimer = 8;

    const text = new Text({
      text: `-${value}`,
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 10,
        fontWeight: "bold",
        fill: 0xff4444,
        stroke: { color: 0x000000, width: 2 },
      }),
    });
    text.anchor.set(0.5, 0.5);
    text.position.set(dmg.x, dmg.y);
    this.addChild(text);
    this.damageTexts.push(text);
  }

  private tickDamageNumbers(dt: number): void {
    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dmg = this.damageNumbers[i];
      dmg.life -= dt;
      dmg.y += dmg.vy * dt;
      const text = this.damageTexts[i];
      text.position.y = dmg.y;
      text.alpha = Math.max(0, dmg.life / 40);

      if (dmg.life <= 0) {
        this.removeChild(text);
        text.destroy();
        this.damageNumbers.splice(i, 1);
        this.damageTexts.splice(i, 1);
      }
    }
  }

  private spawnFlameParticle(): void {
    this.particles.push({
      x: 12 + Math.random() * 4,
      y: 12,
      vx: -1.5 + Math.random() * -1,
      vy: -0.5 + Math.random() * -0.5,
      life: 15 + Math.random() * 10,
      maxLife: 20,
      color: [0xff4400, 0xff8800, 0xffcc00][Math.floor(Math.random() * 3)],
      size: 2 + Math.random() * 2,
    });
  }

  private tickParticles(dt: number): void {
    this.particleGfx.clear();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.04 * dt; // gravity

      const alpha = Math.max(0, p.life / p.maxLife);
      const size = p.size * (0.5 + alpha * 0.5);
      this.particleGfx
        .rect(p.x - size / 2, p.y - size / 2, size, size)
        .fill({ color: p.color, alpha });
    }
  }
}
