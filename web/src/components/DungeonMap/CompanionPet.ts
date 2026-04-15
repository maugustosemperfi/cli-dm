import { Container, Graphics, Text, TextStyle } from "pixi.js";

export type PetType = "cat" | "owl" | "dog" | "fox" | "frog" | "bunny";

type PetState = "follow" | "idle" | "sleep" | "run" | "excited";

const P = 2; // pixel scale

// Role -> pet assignment
const ROLE_PET: Record<string, PetType> = {
  warrior: "dog",
  rogue: "cat",
  mage: "owl",
  ranger: "fox",
  cleric: "bunny",
  bard: "frog",
};

export function petTypeForRole(role: string): PetType {
  return ROLE_PET[role] ?? "cat";
}

// --- Cat (10x10) orange, pointy ears, tail ---
const CAT_FRAMES: Array<Array<[number, number, number]>> = [
  [
    // ears
    [2, 1, 0xd4864a], [7, 1, 0xd4864a],
    [2, 2, 0xd4864a], [3, 2, 0xd4864a], [6, 2, 0xd4864a], [7, 2, 0xd4864a],
    // head
    [3, 3, 0xd4864a], [4, 3, 0xd4864a], [5, 3, 0xd4864a], [6, 3, 0xd4864a],
    [3, 4, 0xc47a3a], [4, 4, 0xd4864a], [5, 4, 0xd4864a], [6, 4, 0xc47a3a],
    // eyes
    [4, 3, 0x222222], [5, 3, 0x222222],
    // body
    [3, 5, 0xd4864a], [4, 5, 0xc47a3a], [5, 5, 0xc47a3a], [6, 5, 0xd4864a],
    [3, 6, 0xd4864a], [4, 6, 0xc47a3a], [5, 6, 0xc47a3a], [6, 6, 0xd4864a],
    // legs
    [3, 7, 0xc47a3a], [6, 7, 0xc47a3a],
    // tail up
    [7, 5, 0xd4864a], [8, 4, 0xd4864a], [8, 3, 0xd4864a],
  ],
  [
    // ears
    [2, 1, 0xd4864a], [7, 1, 0xd4864a],
    [2, 2, 0xd4864a], [3, 2, 0xd4864a], [6, 2, 0xd4864a], [7, 2, 0xd4864a],
    // head
    [3, 3, 0xd4864a], [4, 3, 0xd4864a], [5, 3, 0xd4864a], [6, 3, 0xd4864a],
    [3, 4, 0xc47a3a], [4, 4, 0xd4864a], [5, 4, 0xd4864a], [6, 4, 0xc47a3a],
    // eyes (one closed = licking paw)
    [4, 3, 0x222222], [5, 3, 0x333333],
    // body
    [3, 5, 0xd4864a], [4, 5, 0xc47a3a], [5, 5, 0xc47a3a], [6, 5, 0xd4864a],
    [3, 6, 0xd4864a], [4, 6, 0xc47a3a], [5, 6, 0xc47a3a], [6, 6, 0xd4864a],
    // paw raised
    [2, 5, 0xc47a3a], [6, 7, 0xc47a3a],
    // tail curled
    [7, 6, 0xd4864a], [8, 6, 0xd4864a],
  ],
];

// --- Owl (10x10) brown with yellow eyes ---
const OWL_FRAMES: Array<Array<[number, number, number]>> = [
  [
    // body round
    [3, 2, 0x8b6b4b], [4, 2, 0x8b6b4b], [5, 2, 0x8b6b4b], [6, 2, 0x8b6b4b],
    [2, 3, 0x8b6b4b], [3, 3, 0x7a5a3b], [4, 3, 0x7a5a3b], [5, 3, 0x7a5a3b], [6, 3, 0x7a5a3b], [7, 3, 0x8b6b4b],
    // big eyes
    [3, 3, 0xbfa85b], [6, 3, 0xbfa85b],
    [3, 4, 0x222222], [6, 4, 0x222222],
    // body
    [2, 4, 0x8b6b4b], [4, 4, 0x7a5a3b], [5, 4, 0x7a5a3b], [7, 4, 0x8b6b4b],
    [3, 5, 0x8b6b4b], [4, 5, 0x7a5a3b], [5, 5, 0x7a5a3b], [6, 5, 0x8b6b4b],
    [3, 6, 0x8b6b4b], [4, 6, 0x8b6b4b], [5, 6, 0x8b6b4b], [6, 6, 0x8b6b4b],
    // beak
    [4, 4, 0xbfa85b], [5, 4, 0xbfa85b],
    // feet
    [4, 7, 0x7a5a3b], [5, 7, 0x7a5a3b],
    // wings (up / perched)
    [1, 4, 0x8b6b4b], [8, 4, 0x8b6b4b],
  ],
  [
    // wings flap
    [3, 2, 0x8b6b4b], [4, 2, 0x8b6b4b], [5, 2, 0x8b6b4b], [6, 2, 0x8b6b4b],
    [2, 3, 0x8b6b4b], [3, 3, 0x7a5a3b], [4, 3, 0x7a5a3b], [5, 3, 0x7a5a3b], [6, 3, 0x7a5a3b], [7, 3, 0x8b6b4b],
    [3, 3, 0xbfa85b], [6, 3, 0xbfa85b],
    [3, 4, 0x222222], [6, 4, 0x222222],
    [2, 4, 0x8b6b4b], [4, 4, 0x7a5a3b], [5, 4, 0x7a5a3b], [7, 4, 0x8b6b4b],
    [3, 5, 0x8b6b4b], [4, 5, 0x7a5a3b], [5, 5, 0x7a5a3b], [6, 5, 0x8b6b4b],
    [3, 6, 0x8b6b4b], [4, 6, 0x8b6b4b], [5, 6, 0x8b6b4b], [6, 6, 0x8b6b4b],
    [4, 4, 0xbfa85b], [5, 4, 0xbfa85b],
    [4, 7, 0x7a5a3b], [5, 7, 0x7a5a3b],
    // wings extended up
    [0, 2, 0x8b6b4b], [1, 3, 0x8b6b4b], [8, 3, 0x8b6b4b], [9, 2, 0x8b6b4b],
  ],
];

// --- Dog (10x10) golden, floppy ears ---
const DOG_FRAMES: Array<Array<[number, number, number]>> = [
  [
    // ears (floppy)
    [2, 2, 0xbfa85b], [7, 2, 0xbfa85b],
    [1, 3, 0xbfa85b], [8, 3, 0xbfa85b],
    // head
    [3, 2, 0xbfa85b], [4, 2, 0xbfa85b], [5, 2, 0xbfa85b], [6, 2, 0xbfa85b],
    [3, 3, 0xa89040], [4, 3, 0xbfa85b], [5, 3, 0xbfa85b], [6, 3, 0xa89040],
    // eyes + nose
    [4, 2, 0x222222], [5, 2, 0x222222],
    [4, 3, 0x333333], [5, 3, 0x333333],
    // body
    [3, 4, 0xbfa85b], [4, 4, 0xa89040], [5, 4, 0xa89040], [6, 4, 0xbfa85b],
    [3, 5, 0xbfa85b], [4, 5, 0xa89040], [5, 5, 0xa89040], [6, 5, 0xbfa85b],
    [3, 6, 0xbfa85b], [4, 6, 0xbfa85b], [5, 6, 0xbfa85b], [6, 6, 0xbfa85b],
    // legs
    [3, 7, 0xa89040], [4, 7, 0xa89040], [5, 7, 0xa89040], [6, 7, 0xa89040],
    // tail (right, up)
    [7, 4, 0xbfa85b], [8, 3, 0xbfa85b],
  ],
  [
    // ears (floppy)
    [2, 2, 0xbfa85b], [7, 2, 0xbfa85b],
    [1, 3, 0xbfa85b], [8, 3, 0xbfa85b],
    // head
    [3, 2, 0xbfa85b], [4, 2, 0xbfa85b], [5, 2, 0xbfa85b], [6, 2, 0xbfa85b],
    [3, 3, 0xa89040], [4, 3, 0xbfa85b], [5, 3, 0xbfa85b], [6, 3, 0xa89040],
    [4, 2, 0x222222], [5, 2, 0x222222],
    [4, 3, 0x333333], [5, 3, 0x333333],
    // body
    [3, 4, 0xbfa85b], [4, 4, 0xa89040], [5, 4, 0xa89040], [6, 4, 0xbfa85b],
    [3, 5, 0xbfa85b], [4, 5, 0xa89040], [5, 5, 0xa89040], [6, 5, 0xbfa85b],
    [3, 6, 0xbfa85b], [4, 6, 0xbfa85b], [5, 6, 0xbfa85b], [6, 6, 0xbfa85b],
    // legs (alt)
    [3, 7, 0xa89040], [6, 7, 0xa89040],
    // tail wagging (right, more right)
    [7, 3, 0xbfa85b], [8, 2, 0xbfa85b],
  ],
];

// --- Fox (10x10) orange-red, bushy tail ---
const FOX_FRAMES: Array<Array<[number, number, number]>> = [
  [
    // ears
    [2, 1, 0xbf7b5b], [7, 1, 0xbf7b5b],
    [2, 2, 0xbf7b5b], [3, 2, 0xbf7b5b], [6, 2, 0xbf7b5b], [7, 2, 0xbf7b5b],
    // head
    [3, 3, 0xbf7b5b], [4, 3, 0xbf7b5b], [5, 3, 0xbf7b5b], [6, 3, 0xbf7b5b],
    [3, 4, 0xa06545], [4, 4, 0xbf7b5b], [5, 4, 0xbf7b5b], [6, 4, 0xa06545],
    // eyes
    [4, 3, 0x222222], [5, 3, 0x222222],
    // muzzle
    [4, 4, 0xdbdee1], [5, 4, 0xdbdee1],
    // body
    [3, 5, 0xbf7b5b], [4, 5, 0xa06545], [5, 5, 0xa06545], [6, 5, 0xbf7b5b],
    [3, 6, 0xbf7b5b], [4, 6, 0xa06545], [5, 6, 0xa06545], [6, 6, 0xbf7b5b],
    // legs
    [3, 7, 0xa06545], [6, 7, 0xa06545],
    // bushy tail
    [7, 4, 0xbf7b5b], [8, 3, 0xbf7b5b], [8, 4, 0xbf7b5b], [9, 4, 0xdbdee1],
  ],
  [
    // ears
    [2, 1, 0xbf7b5b], [7, 1, 0xbf7b5b],
    [2, 2, 0xbf7b5b], [3, 2, 0xbf7b5b], [6, 2, 0xbf7b5b], [7, 2, 0xbf7b5b],
    // head
    [3, 3, 0xbf7b5b], [4, 3, 0xbf7b5b], [5, 3, 0xbf7b5b], [6, 3, 0xbf7b5b],
    [3, 4, 0xa06545], [4, 4, 0xbf7b5b], [5, 4, 0xbf7b5b], [6, 4, 0xa06545],
    [4, 3, 0x222222], [5, 3, 0x222222],
    [4, 4, 0xdbdee1], [5, 4, 0xdbdee1],
    // curled sleeping body
    [3, 5, 0xbf7b5b], [4, 5, 0xa06545], [5, 5, 0xa06545], [6, 5, 0xbf7b5b],
    [3, 6, 0xbf7b5b], [4, 6, 0xbf7b5b], [5, 6, 0xbf7b5b], [6, 6, 0xbf7b5b],
    // tail curled under
    [7, 6, 0xbf7b5b], [8, 6, 0xbf7b5b], [8, 7, 0xdbdee1],
    // legs tucked
    [3, 7, 0xa06545], [6, 7, 0xa06545],
  ],
];

// --- Frog (10x10) green, big eyes, hops ---
const FROG_FRAMES: Array<Array<[number, number, number]>> = [
  [
    // big eyes on top
    [3, 1, 0x5baf7b], [4, 1, 0x5baf7b], [6, 1, 0x5baf7b], [7, 1, 0x5baf7b],
    [3, 1, 0xffffff], [6, 1, 0xffffff],
    [3, 2, 0x222222], [6, 2, 0x222222],
    // head
    [3, 3, 0x5baf7b], [4, 3, 0x5baf7b], [5, 3, 0x5baf7b], [6, 3, 0x5baf7b],
    // body (squat)
    [2, 4, 0x5baf7b], [3, 4, 0x4a9e6a], [4, 4, 0x4a9e6a], [5, 4, 0x4a9e6a], [6, 4, 0x4a9e6a], [7, 4, 0x5baf7b],
    [2, 5, 0x5baf7b], [3, 5, 0x4a9e6a], [4, 5, 0x4a9e6a], [5, 5, 0x4a9e6a], [6, 5, 0x4a9e6a], [7, 5, 0x5baf7b],
    [3, 6, 0x5baf7b], [4, 6, 0x5baf7b], [5, 6, 0x5baf7b], [6, 6, 0x5baf7b],
    // legs bent
    [1, 5, 0x4a9e6a], [8, 5, 0x4a9e6a],
    [1, 6, 0x4a9e6a], [2, 6, 0x4a9e6a], [7, 6, 0x4a9e6a], [8, 6, 0x4a9e6a],
  ],
  [
    // mid-hop (legs extended)
    [3, 0, 0x5baf7b], [4, 0, 0x5baf7b], [6, 0, 0x5baf7b], [7, 0, 0x5baf7b],
    [3, 0, 0xffffff], [6, 0, 0xffffff],
    [3, 1, 0x222222], [6, 1, 0x222222],
    [3, 2, 0x5baf7b], [4, 2, 0x5baf7b], [5, 2, 0x5baf7b], [6, 2, 0x5baf7b],
    [2, 3, 0x5baf7b], [3, 3, 0x4a9e6a], [4, 3, 0x4a9e6a], [5, 3, 0x4a9e6a], [6, 3, 0x4a9e6a], [7, 3, 0x5baf7b],
    [3, 4, 0x5baf7b], [4, 4, 0x4a9e6a], [5, 4, 0x4a9e6a], [6, 4, 0x5baf7b],
    // legs extended down
    [1, 5, 0x4a9e6a], [2, 5, 0x4a9e6a], [7, 5, 0x4a9e6a], [8, 5, 0x4a9e6a],
    [0, 6, 0x4a9e6a], [9, 6, 0x4a9e6a],
  ],
];

// --- Bunny (10x10) white with pink inner ears ---
const BUNNY_FRAMES: Array<Array<[number, number, number]>> = [
  [
    // long ears
    [3, 0, 0xdbdee1], [6, 0, 0xdbdee1],
    [3, 1, 0xdbdee1], [4, 1, 0xd4747a], [5, 1, 0xd4747a], [6, 1, 0xdbdee1],
    [3, 2, 0xdbdee1], [6, 2, 0xdbdee1],
    // head
    [3, 3, 0xdbdee1], [4, 3, 0xdbdee1], [5, 3, 0xdbdee1], [6, 3, 0xdbdee1],
    [3, 4, 0xc4c7ca], [4, 4, 0xdbdee1], [5, 4, 0xdbdee1], [6, 4, 0xc4c7ca],
    // eyes + nose
    [4, 3, 0x222222], [5, 3, 0x222222],
    [4, 4, 0xd4747a],
    // body
    [3, 5, 0xdbdee1], [4, 5, 0xc4c7ca], [5, 5, 0xc4c7ca], [6, 5, 0xdbdee1],
    [3, 6, 0xdbdee1], [4, 6, 0xdbdee1], [5, 6, 0xdbdee1], [6, 6, 0xdbdee1],
    // tail (puff)
    [7, 5, 0xdbdee1], [7, 6, 0xdbdee1],
    // feet
    [3, 7, 0xc4c7ca], [6, 7, 0xc4c7ca],
  ],
  [
    // ears slightly back (hopping)
    [3, 1, 0xdbdee1], [6, 1, 0xdbdee1],
    [3, 2, 0xdbdee1], [4, 2, 0xd4747a], [5, 2, 0xd4747a], [6, 2, 0xdbdee1],
    // head
    [3, 3, 0xdbdee1], [4, 3, 0xdbdee1], [5, 3, 0xdbdee1], [6, 3, 0xdbdee1],
    [3, 4, 0xc4c7ca], [4, 4, 0xdbdee1], [5, 4, 0xdbdee1], [6, 4, 0xc4c7ca],
    [4, 3, 0x222222], [5, 3, 0x222222],
    [4, 4, 0xd4747a],
    // body (compressed = about to hop)
    [2, 5, 0xdbdee1], [3, 5, 0xdbdee1], [4, 5, 0xc4c7ca], [5, 5, 0xc4c7ca], [6, 5, 0xdbdee1], [7, 5, 0xdbdee1],
    [3, 6, 0xdbdee1], [4, 6, 0xdbdee1], [5, 6, 0xdbdee1], [6, 6, 0xdbdee1],
    // tail
    [7, 5, 0xdbdee1],
    // feet extended
    [2, 7, 0xc4c7ca], [3, 7, 0xc4c7ca], [6, 7, 0xc4c7ca], [7, 7, 0xc4c7ca],
  ],
];

const PET_FRAMES: Record<PetType, Array<Array<[number, number, number]>>> = {
  cat: CAT_FRAMES,
  owl: OWL_FRAMES,
  dog: DOG_FRAMES,
  fox: FOX_FRAMES,
  frog: FROG_FRAMES,
  bunny: BUNNY_FRAMES,
};

// Pet offset behind owner
const FOLLOW_OFFSET_X = -20;
const FOLLOW_OFFSET_Y = 15;
const SPRING_K = 0.06;
const SPRING_DAMP = 0.85;
const IDLE_THRESHOLD = 0.3;
const SLEEP_TICKS = 300;
const EXCITED_DURATION = 60;
const RUN_THRESHOLD = 2.0;

export class CompanionPet extends Container {
  private petType: PetType;
  private gfx: Graphics;
  private shadowGfx: Graphics;
  private zzzText: Text | null = null;
  private dustGfx: Graphics;

  private state: PetState = "follow";
  private frameIndex = 0;
  private animTimer = 0;
  private time = 0;

  // Spring physics
  private velX = 0;
  private velY = 0;
  private targetX = 0;
  private targetY = 0;

  // State trackers
  private idleTicks = 0;
  private excitedTicks = 0;
  private prevOwnerX = 0;
  private prevOwnerY = 0;
  private prevAction = "";
  private ownerSpeed = 0;

  constructor(petType: PetType) {
    super();
    this.petType = petType;

    // Shadow
    this.shadowGfx = new Graphics();
    this.shadowGfx.ellipse(10, 17, 5, 2).fill({ color: 0x000000, alpha: 0.15 });
    this.addChild(this.shadowGfx);

    // Pet sprite
    this.gfx = new Graphics();
    this.addChild(this.gfx);

    // Dust trail (for running)
    this.dustGfx = new Graphics();
    this.addChild(this.dustGfx);

    this.drawFrame();
  }

  tick(dt: number, ownerX: number, ownerY: number, ownerAction: string): void {
    this.time += dt;

    // Calculate owner movement speed
    const dx = ownerX - this.prevOwnerX;
    const dy = ownerY - this.prevOwnerY;
    this.ownerSpeed = Math.sqrt(dx * dx + dy * dy);
    this.prevOwnerX = ownerX;
    this.prevOwnerY = ownerY;

    // Detect task completion (action changed to idle/completed from something active)
    if (ownerAction !== this.prevAction && this.prevAction !== "" && ownerAction === "idle") {
      this.excitedTicks = EXCITED_DURATION;
    }
    this.prevAction = ownerAction;

    // State transitions
    this.updateState(ownerAction);

    // Target position (follow owner with offset)
    this.targetX = ownerX + FOLLOW_OFFSET_X;
    this.targetY = ownerY + FOLLOW_OFFSET_Y;

    // Spring physics
    const ax = (this.targetX - this.position.x) * SPRING_K;
    const ay = (this.targetY - this.position.y) * SPRING_K;
    this.velX = (this.velX + ax) * SPRING_DAMP;
    this.velY = (this.velY + ay) * SPRING_DAMP;
    this.position.x += this.velX * dt;
    this.position.y += this.velY * dt;

    // State-specific Y offset
    let bounceY = 0;
    switch (this.state) {
      case "follow":
        bounceY = -Math.abs(Math.sin(this.time * 0.06)) * 2;
        break;
      case "idle":
        bounceY = Math.sin(this.time * 0.02) * 0.5;
        break;
      case "sleep":
        bounceY = Math.sin(this.time * 0.015) * 0.3; // breathing
        break;
      case "run":
        bounceY = -Math.abs(Math.sin(this.time * 0.12)) * 4;
        break;
      case "excited":
        bounceY = -Math.abs(Math.sin(this.time * 0.15)) * 6;
        break;
    }

    // Frog hops instead of smooth following
    if (this.petType === "frog" && (this.state === "follow" || this.state === "run")) {
      bounceY = -Math.abs(Math.sin(this.time * 0.08)) * 5;
    }

    this.gfx.position.y = bounceY;
    this.shadowGfx.alpha = 0.15 + Math.abs(bounceY) * 0.01;

    // Frame animation
    this.animTimer += dt;
    const frameDelay = this.state === "run" ? 8 : this.state === "excited" ? 6 : 20;
    if (this.animTimer >= frameDelay) {
      this.animTimer = 0;
      this.frameIndex = (this.frameIndex + 1) % 2;
      this.drawFrame();
    }

    // Zzz text for sleeping
    this.updateZzz();

    // Dust particles for running
    this.updateDust();

    // Excited spin
    if (this.state === "excited") {
      this.excitedTicks -= dt;
      this.gfx.rotation = Math.sin(this.time * 0.2) * 0.3;
    } else {
      this.gfx.rotation = 0;
    }
  }

  private updateState(ownerAction: string): void {
    if (this.excitedTicks > 0) {
      this.state = "excited";
      this.idleTicks = 0;
      return;
    }

    if (this.ownerSpeed > RUN_THRESHOLD) {
      this.state = "run";
      this.idleTicks = 0;
      return;
    }

    const isOwnerIdle =
      ownerAction === "idle" || ownerAction === "thinking";

    if (isOwnerIdle) {
      this.idleTicks += 1;
      if (this.idleTicks >= SLEEP_TICKS) {
        this.state = "sleep";
      } else if (this.ownerSpeed < IDLE_THRESHOLD) {
        this.state = "idle";
      }
    } else {
      this.idleTicks = 0;
      this.state = "follow";
    }
  }

  private updateZzz(): void {
    if (this.state === "sleep") {
      if (!this.zzzText) {
        this.zzzText = new Text({
          text: "z z z",
          style: new TextStyle({
            fontFamily: "monospace",
            fontSize: 8,
            fill: 0x8b9aab,
          }),
        });
        this.zzzText.anchor.set(0.5, 1);
        this.addChild(this.zzzText);
      }
      this.zzzText.position.set(
        14,
        -4 + Math.sin(this.time * 0.03) * 2,
      );
      this.zzzText.alpha = 0.5 + Math.sin(this.time * 0.04) * 0.3;
    } else if (this.zzzText) {
      this.removeChild(this.zzzText);
      this.zzzText.destroy();
      this.zzzText = null;
    }
  }

  private updateDust(): void {
    this.dustGfx.clear();
    if (this.state !== "run") return;

    // Small dust puffs behind pet
    const numPuffs = 3;
    for (let i = 0; i < numPuffs; i++) {
      const age = ((this.time * 0.1 + i * 2) % 6);
      if (age > 4) continue;
      const alpha = Math.max(0, 0.3 - age * 0.08);
      const size = 1 + age * 0.5;
      this.dustGfx
        .circle(10 + i * 4 + age * 3, 17 + Math.random(), size)
        .fill({ color: 0x8b9aab, alpha });
    }
  }

  private drawFrame(): void {
    this.gfx.clear();
    const frames = PET_FRAMES[this.petType];
    if (!frames) return;
    const pixels = frames[this.frameIndex % frames.length];
    for (const [x, y, color] of pixels) {
      this.gfx.rect(x * P, y * P, P, P).fill({ color });
    }
  }
}
