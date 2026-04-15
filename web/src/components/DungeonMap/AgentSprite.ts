import { Container, FederatedPointerEvent, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { ActionType, AgentRole } from "../../protocol/events";
import { AGENT_HEX, THEME } from "./theme";
import { CharacterRenderer, CHAR_WIDTH, CHAR_HEIGHT, type AnimState } from "./sprites/CharacterRenderer";
import { SpeechBubble } from "./SpeechBubble";

// Movement pattern: returns (offsetX, offsetY) from base position
type MovementFn = (t: number) => [number, number];

const MOVEMENTS: Record<string, MovementFn> = {
  idle: () => [0, 0],
  thinking: (t) => [
    Math.sin(t * 0.005) * 2,
    Math.sin(t * 0.012) * 8,
  ],
  read: (t) => [
    Math.sin(t * 0.015) * 14,
    Math.cos(t * 0.008) * 3,
  ],
  edit: (t) => [
    Math.sin(t * 0.01) * 3,
    -Math.abs(Math.sin(t * 0.04)) * 10,
  ],
  test: (t) => [
    Math.sin(t * 0.06) * 16 + Math.sin(t * 0.09) * 6,
    Math.cos(t * 0.07) * 12 + Math.cos(t * 0.04) * 4,
  ],
  git: (t) => [
    Math.cos(t * 0.025) * 18,
    Math.sin(t * 0.025) * 18,
  ],
  build: (t) => [
    Math.cos(t * 0.02) * (8 + Math.sin(t * 0.008) * 6),
    Math.sin(t * 0.02) * (8 + Math.sin(t * 0.008) * 6),
  ],
  shell: (t) => [
    Math.sin(t * 0.02) * 10,
    Math.cos(t * 0.015) * 6,
  ],
  network: (t) => [
    Math.sin(t * 0.03) * 12,
    Math.cos(t * 0.02) * 8,
  ],
  error: (t) => [
    (Math.random() - 0.5) * 6 + Math.sin(t * 0.1) * 4,
    (Math.random() - 0.5) * 6,
  ],
  blocked: (t) => {
    const cycle = (t * 0.03) % (Math.PI * 2);
    const push = Math.sin(cycle);
    return [push > 0 ? push * 14 : push * 3, Math.sin(t * 0.05) * 2];
  },
};

// Map ActionType to AnimState for the pixel art
function actionToAnim(action: ActionType, isBlocked: boolean): AnimState {
  if (isBlocked) return "blocked";
  switch (action) {
    case "idle":
    case "thinking":
      return "idle";
    case "read":
    case "edit":
    case "shell":
    case "test":
    case "build":
    case "git":
    case "network":
      return "action";
    case "error":
    case "blocked":
      return "blocked";
    default:
      return "idle";
  }
}

// Frame timing per anim state (in ticks, ~16ms each)
const FRAME_DELAYS: Record<AnimState, number> = {
  idle: 24,     // ~400ms per frame
  walk: 12,     // ~200ms per frame
  action: 16,   // ~260ms per frame
  blocked: 10,  // ~160ms per frame (fast struggle)
};

// Action ring pulse speed
const RING_PULSE: Record<string, number> = {
  idle: 0,
  thinking: 0.015,
  read: 0.02,
  edit: 0.03,
  shell: 0.025,
  test: 0.06,
  git: 0.035,
  build: 0.04,
  network: 0.03,
  error: 0.08,
  blocked: 0.04,
};

/** Shared renderer instance — set once from DungeonMap.tsx */
let sharedRenderer: CharacterRenderer | null = null;

export function setCharacterRenderer(renderer: CharacterRenderer) {
  sharedRenderer = renderer;
}

export function getCharacterRenderer(): CharacterRenderer | null {
  return sharedRenderer;
}

export class AgentSprite extends Container {
  agentId: string;
  role: AgentRole;
  private characterSprite: Sprite;
  private shadow: Graphics;
  private nameTag: Text;
  private actionRing: Graphics;
  private trail: Graphics;
  private color: number;
  private time = 0;
  private currentAction: ActionType = "idle";
  private currentDetail: string | undefined;
  private isBlocked = false;
  private isComplete = false;

  /** Public accessors for DungeonMap ticker */
  get currentActionPublic(): ActionType { return this.currentAction; }
  get isCompletePublic(): boolean { return this.isComplete; }
  private animState: AnimState = "idle";
  private frameIndex = 0;
  private frameTimer = 0;
  private facingLeft = false;
  private prevX = 0;
  private speechBubble: SpeechBubble;

  // Base position (center of assigned room)
  private baseX = 0;
  private baseY = 0;
  private targetBaseX = 0;
  private targetBaseY = 0;

  // Trail positions
  private trailHistory: Array<[number, number]> = [];

  // Drag-to-rearrange
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private layoutX = 0; // last position assigned by layout
  private layoutY = 0;
  manuallyPositioned = false;

  // Corridor wandering — characters explore the dungeon through corridors
  private wanderPath: Array<[number, number]> = [];
  private wanderIndex = 0;
  private wanderSpeed = 3.0;
  private wanderState: "home" | "going_out" | "visiting" | "returning" = "home";
  private wanderCooldown = 0;      // ticks until next wander attempt
  private wanderVisitTimer = 0;    // ticks spent visiting a neighbor
  private homeX = 0;               // home room center
  private homeY = 0;
  // Neighbors: positions of rooms connected via DAG edges
  private neighbors: Array<{ nodeId: string; x: number; y: number }> = [];

  constructor(agentId: string, role: AgentRole) {
    super();
    this.agentId = agentId;
    this.role = role;
    this.color = AGENT_HEX[role] ?? 0x8b9aab;
    this.eventMode = "static";
    this.cursor = "pointer";

    // Trail (drawn behind everything)
    this.trail = new Graphics();
    this.trail.alpha = 0.5;
    this.addChild(this.trail);

    // Shadow under character
    this.shadow = new Graphics();
    this.shadow.ellipse(0, 4, 14, 5).fill({ color: 0x000000, alpha: 0.25 });
    this.shadow.position.set(CHAR_WIDTH / 2, CHAR_HEIGHT - 4);
    this.addChild(this.shadow);

    // Action indicator ring (outermost, behind character)
    this.actionRing = new Graphics();
    this.addChild(this.actionRing);

    // Character sprite
    this.characterSprite = new Sprite();
    this.characterSprite.anchor.set(0.5, 0.5);
    this.characterSprite.position.set(0, 0);
    this.addChild(this.characterSprite);

    // Name tag below character
    this.nameTag = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 10,
        fill: this.color,
        align: "center",
      }),
    });
    this.nameTag.anchor.set(0.5, 0);
    this.nameTag.position.set(0, CHAR_HEIGHT / 2 + 2);
    this.addChild(this.nameTag);

    // Level-up effect ring (behind everything else)
    this.levelUpRing = new Graphics();
    this.levelUpRing.alpha = 0;
    this.addChild(this.levelUpRing);

    // Level badge (below name)
    this.levelBadge = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: 9,
        fill: 0xbfa85b,
        fontWeight: "bold",
      }),
    });
    this.levelBadge.anchor.set(0.5, 0);
    this.levelBadge.position.set(0, CHAR_HEIGHT / 2 + 14);
    this.levelBadge.alpha = 0;
    this.addChild(this.levelBadge);

    // Speech bubble (above character)
    this.speechBubble = new SpeechBubble();
    const bubbleY = -CHAR_HEIGHT / 2 - 8;
    this.speechBubble.position.set(0, bubbleY);
    this.speechBubble.setBaseY(bubbleY);
    this.addChild(this.speechBubble);

    // Drag-to-rearrange handlers
    this.on("pointerdown", this.onDragStart, this);
    this.on("globalpointermove", this.onDragMove, this);
    this.on("pointerup", this.onDragEnd, this);
    this.on("pointerupoutside", this.onDragEnd, this);

    this.updateTexture();
  }

  private greetingTimer = 0;
  private greetingActive = false;
  private levelUpTimer = 0;
  private levelUpRing: Graphics;
  private levelBadge: Text;
  private compactTimer = 0;
  private compactParticles: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];

  setName(name: string) {
    this.nameTag.text = name;
  }

  /** Show golden burst animation for level-up */
  triggerLevelUp(level: number) {
    this.levelUpTimer = 90; // ~1.5s at 60fps
    this.levelBadge.text = `Lv.${level}`;
    this.levelBadge.alpha = 1;
    this.speechBubble.forceText(`LEVEL ${level}!`);
  }

  /** Temporarily show a greeting message in the speech bubble */
  showGreeting(text: string, durationTicks = 120) {
    this.greetingActive = true;
    this.greetingTimer = durationTicks;
    // Directly set bubble to greeting text with full alpha
    this.speechBubble.forceText(text);
  }

  update(action: ActionType, blocked: boolean, complete: boolean, detail?: string) {
    const newAnim = actionToAnim(action, blocked);
    if (newAnim !== this.animState) {
      this.frameIndex = 0;
      this.frameTimer = 0;
      this.animState = newAnim;
    }
    this.currentAction = action;
    this.currentDetail = detail;
    this.isBlocked = blocked;
    this.isComplete = complete;
    this.alpha = complete ? 0.35 : 1;

    // Trigger compaction brain-clearing particles
    if (detail === "compacting memory" && this.compactTimer <= 0) {
      this.compactTimer = 60; // ~1s
      this.compactParticles = [];
      for (let i = 0; i < 12; i++) {
        const angle = (Math.PI * 2 * i) / 12 + (Math.random() - 0.5) * 0.3;
        this.compactParticles.push({
          x: 0,
          y: -CHAR_HEIGHT / 2 - 4,
          vx: Math.cos(angle) * (1.5 + Math.random()),
          vy: Math.sin(angle) * (1.5 + Math.random()) - 1,
          life: 1,
        });
      }
    }

    // Permission: shrink character to simulate kneeling
    if (detail === "awaiting permission") {
      this.characterSprite.scale.y = 0.75;
      this.characterSprite.position.y = 4; // shift down slightly
    } else if (this.characterSprite.scale.y !== 1) {
      this.characterSprite.scale.y = 1;
      this.characterSprite.position.y = 0;
    }

    if (!this.greetingActive) {
      this.speechBubble.setText(action, detail);
    }
  }

  /** Tell the agent about neighboring rooms it can wander to */
  setNeighbors(neighbors: Array<{ nodeId: string; x: number; y: number }>) {
    this.neighbors = neighbors;
  }

  /** Set a corridor path for the agent to walk along (used for room transitions) */
  setWanderPath(waypoints: Array<[number, number]>) {
    if (waypoints.length < 2) return;
    this.wanderPath = waypoints;
    this.wanderIndex = 0;
    this.wanderState = "going_out";
  }

  /** Build bezier waypoints between two points (corridor curve) */
  private buildCorridorPath(fromX: number, fromY: number, toX: number, toY: number): Array<[number, number]> {
    const waypoints: Array<[number, number]> = [];
    const steps = 16;
    const midX = (fromX + toX) / 2;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      const px = u * u * u * fromX + 3 * u * u * t * midX + 3 * u * t * t * midX + t * t * t * toX;
      const py = u * u * u * fromY + 3 * u * u * t * fromY + 3 * u * t * t * toY + t * t * t * toY;
      waypoints.push([px, py]);
    }
    return waypoints;
  }

  /** Start a wander trip to a random neighbor and back */
  private startWander() {
    if (this.neighbors.length === 0) return;
    if (this.wanderState !== "home") return;

    const neighbor = this.neighbors[Math.floor(Math.random() * this.neighbors.length)];
    const path = this.buildCorridorPath(this.homeX, this.homeY, neighbor.x, neighbor.y);
    this.wanderPath = path;
    this.wanderIndex = 0;
    this.wanderState = "going_out";
    this.wanderVisitTimer = 0;
  }

  moveTo(x: number, y: number) {
    // If layout assigns a different room, clear manual positioning
    if (this.manuallyPositioned &&
        (Math.abs(x - this.layoutX) > 1 || Math.abs(y - this.layoutY) > 1)) {
      this.manuallyPositioned = false;
    }
    this.layoutX = x;
    this.layoutY = y;
    this.homeX = x;
    this.homeY = y;

    if (this.manuallyPositioned) return;

    // If actively wandering along a corridor, don't snap — let them walk
    if (this.wanderState === "going_out" || this.wanderState === "returning") {
      return;
    }

    // If visiting a neighbor, let them finish the visit
    if (this.wanderState === "visiting") {
      return;
    }

    this.targetBaseX = x;
    this.targetBaseY = y;
    if (this.baseX === 0 && this.baseY === 0) {
      this.baseX = x;
      this.baseY = y;
      this.position.set(x, y);
    }
  }

  tick(dt: number) {
    this.time += dt;

    // During drag: position directly, skip movement patterns
    if (this.isDragging) {
      this.position.set(this.baseX, this.baseY);
      this.actionRing.clear();
      this.trail.clear();
      if (this.greetingActive) {
        this.greetingTimer -= dt;
        if (this.greetingTimer <= 0) {
          this.greetingActive = false;
          this.speechBubble.setText(this.currentAction, undefined);
        }
      }
      this.speechBubble.tick(dt);
      return;
    }

    // --- Corridor wandering state machine ---
    // How eagerly each action type explores (0 = never, higher = more often)
    const WANDER_CHANCE: Record<string, number> = {
      idle: 0,           // idle agents stay in their room
      read: 0.035,       // actively exploring corridors
      thinking: 0.006,   // sometimes paces the halls
      edit: 0.015,       // steps out between edits
      test: 0.004,       // focused but takes breaks
      build: 0.008,      // checks neighboring forges
      git: 0.025,        // moving between areas frequently
      shell: 0.018,      // running errands
      network: 0.020,    // summoning from different rooms
      error: 0,          // panicking, stays put
      blocked: 0,        // stuck, can't move
    };

    // How long to linger at a visited room (in ticks, ~60 = 1 second)
    const VISIT_DURATION: Record<string, number> = {
      idle: 60,          // brief pause, looks around
      read: 120,         // examines things carefully
      thinking: 40,      // quick glance
      edit: 70,
      test: 30,
      build: 50,
      git: 80,
      shell: 50,
      network: 90,       // ritual takes time
    };

    if (this.wanderState === "home" && !this.isComplete && !this.isBlocked) {
      this.wanderCooldown -= dt;
      if (this.wanderCooldown <= 0) {
        const chance = WANDER_CHANCE[this.currentAction] ?? 0.002;
        if (Math.random() < chance * dt && this.neighbors.length > 0) {
          this.startWander();
        }
        this.wanderCooldown = 10; // check again in ~10 ticks
      }
    }

    // Follow waypoints along corridor
    if ((this.wanderState === "going_out" || this.wanderState === "returning") &&
        this.wanderPath.length > 0 && this.wanderIndex < this.wanderPath.length) {
      const target = this.wanderPath[this.wanderIndex];
      const wdx = target[0] - this.baseX;
      const wdy = target[1] - this.baseY;
      const wdist = Math.sqrt(wdx * wdx + wdy * wdy);
      if (wdist < 3) {
        this.wanderIndex++;
        if (this.wanderIndex >= this.wanderPath.length) {
          if (this.wanderState === "going_out") {
            // Arrived at neighbor — linger there
            this.wanderState = "visiting";
            this.wanderVisitTimer = VISIT_DURATION[this.currentAction] ?? 80;
            this.wanderPath = [];
            this.wanderIndex = 0;
          } else {
            // Returned home
            this.wanderState = "home";
            this.wanderPath = [];
            this.wanderIndex = 0;
            this.targetBaseX = this.homeX;
            this.targetBaseY = this.homeY;
            this.wanderCooldown = 30 + Math.random() * 60; // short pause before next wander
          }
        }
      } else {
        const step = this.wanderSpeed * dt;
        this.baseX += (wdx / wdist) * Math.min(step, wdist);
        this.baseY += (wdy / wdist) * Math.min(step, wdist);
        this.targetBaseX = this.baseX;
        this.targetBaseY = this.baseY;
      }
    }

    // Visiting timer — linger at neighbor room, then head home
    if (this.wanderState === "visiting") {
      this.wanderVisitTimer -= dt;
      if (this.wanderVisitTimer <= 0) {
        // Build return path (reverse corridor)
        const returnPath = this.buildCorridorPath(this.baseX, this.baseY, this.homeX, this.homeY);
        this.wanderPath = returnPath;
        this.wanderIndex = 0;
        this.wanderState = "returning";
      }
    }

    // Smooth base position interpolation
    this.baseX += (this.targetBaseX - this.baseX) * 0.06;
    this.baseY += (this.targetBaseY - this.baseY) * 0.06;

    if (this.isComplete) {
      this.position.set(this.baseX, this.baseY);
      this.animState = "idle";
      this.updateTexture();
      this.actionRing.clear();
      this.trail.clear();
      return;
    }

    // Movement offset
    const action = this.isBlocked ? "blocked" : this.currentAction;
    const moveFn = MOVEMENTS[action] ?? MOVEMENTS.idle;
    const [ox, oy] = moveFn(this.time);
    const finalX = this.baseX + ox;
    const finalY = this.baseY + oy;

    // Detect facing direction from horizontal movement
    const dx = finalX - this.prevX;
    if (dx < -0.5) this.facingLeft = true;
    if (dx > 0.5) this.facingLeft = false;
    this.prevX = finalX;

    // Flip sprite for facing
    this.characterSprite.scale.x = this.facingLeft ? -1 : 1;

    // Detect walking (significant movement = walk anim)
    const speed = Math.sqrt(ox * ox + oy * oy);
    if (!this.isBlocked && speed > 5 && this.animState !== "blocked") {
      if (this.animState !== "walk") {
        this.animState = "walk";
        this.frameIndex = 0;
        this.frameTimer = 0;
      }
    } else if (this.animState === "walk" && speed <= 5) {
      this.animState = actionToAnim(this.currentAction, this.isBlocked);
      this.frameIndex = 0;
      this.frameTimer = 0;
    }

    this.position.set(finalX, finalY);

    // Advance animation frame
    this.frameTimer += dt;
    const delay = FRAME_DELAYS[this.animState] ?? FRAME_DELAYS.idle;
    if (this.frameTimer >= delay) {
      const renderer = sharedRenderer;
      if (renderer) {
        const count = renderer.getFrameCount(this.role, this.animState);
        this.frameIndex = (this.frameIndex + 1) % count;
      }
      this.frameTimer = 0;
      this.updateTexture();
    }

    // Greeting timer
    if (this.greetingActive) {
      this.greetingTimer -= dt;
      if (this.greetingTimer <= 0) {
        this.greetingActive = false;
        // Restore normal bubble
        this.speechBubble.setText(this.currentAction, undefined);
      }
    }

    // Level-up animation
    if (this.levelUpTimer > 0) {
      this.levelUpTimer -= dt;
      const progress = 1 - this.levelUpTimer / 90;
      const expandR = CHAR_WIDTH / 2 + progress * 40;
      this.levelUpRing.clear();
      this.levelUpRing
        .circle(0, 0, expandR)
        .stroke({ color: 0xbfa85b, width: 3, alpha: 1 - progress });
      this.levelUpRing
        .circle(0, 0, expandR * 0.6)
        .stroke({ color: 0xffd700, width: 2, alpha: (1 - progress) * 0.7 });
      this.levelUpRing.alpha = 1;
      this.levelBadge.alpha = 1 - progress * 0.5;
      if (this.levelUpTimer <= 0) {
        this.levelUpRing.clear();
        this.levelUpRing.alpha = 0;
        this.levelBadge.alpha = 0;
      }
    }

    // Compaction brain-clearing particles
    if (this.compactTimer > 0) {
      this.compactTimer -= dt;
      this.levelUpRing.clear(); // reuse the ring graphics for particles
      for (const p of this.compactParticles) {
        p.x += p.vx * dt * 0.5;
        p.y += p.vy * dt * 0.5;
        p.life -= dt / 60;
        if (p.life > 0) {
          const size = 2 + p.life * 2;
          this.levelUpRing
            .circle(p.x, p.y, size)
            .fill({ color: 0x5b8abf, alpha: p.life * 0.8 });
          // Small sparkle
          this.levelUpRing
            .circle(p.x + 1, p.y - 1, size * 0.5)
            .fill({ color: 0xdbdee1, alpha: p.life * 0.5 });
        }
      }
      this.levelUpRing.alpha = 1;
      if (this.compactTimer <= 0) {
        this.levelUpRing.clear();
        this.levelUpRing.alpha = 0;
        this.compactParticles = [];
      }
    }

    // Permission: draw hourglass/question mark above character
    if (this.currentDetail === "awaiting permission" && this.levelUpTimer <= 0 && this.compactTimer <= 0) {
      const bob = Math.sin(this.time * 0.04) * 2;
      const blink = Math.sin(this.time * 0.06) > 0 ? 0.9 : 0.5;
      this.levelUpRing.clear();
      // Question mark symbol
      this.levelUpRing
        .circle(0, -CHAR_HEIGHT / 2 - 16 + bob, 8)
        .fill({ color: 0xbfa85b, alpha: blink * 0.3 })
        .stroke({ color: 0xbfa85b, width: 1.5, alpha: blink });
      this.levelUpRing.alpha = 1;
    }

    // Speech bubble animation
    this.speechBubble.tick(dt);

    // Trail
    this.trailHistory.push([finalX, finalY]);
    if (this.trailHistory.length > 60) this.trailHistory.shift();
    this.drawTrail();

    // Action ring
    const ringSpeed = RING_PULSE[action] ?? 0;
    if (this.isBlocked) {
      this.drawBlockedRing();
    } else if (ringSpeed > 0) {
      this.drawActionRing(ringSpeed);
    } else {
      this.actionRing.clear();
    }
  }

  // --- Drag-to-rearrange ---

  private onDragStart(e: FederatedPointerEvent) {
    e.stopPropagation();
    this.isDragging = true;
    this.cursor = "grabbing";
    const local = this.parent!.toLocal(e.global);
    this.dragOffsetX = this.baseX - local.x;
    this.dragOffsetY = this.baseY - local.y;
  }

  private onDragMove(e: FederatedPointerEvent) {
    if (!this.isDragging) return;
    const local = this.parent!.toLocal(e.global);
    const newX = local.x + this.dragOffsetX;
    const newY = local.y + this.dragOffsetY;
    this.baseX = newX;
    this.baseY = newY;
    this.targetBaseX = newX;
    this.targetBaseY = newY;
    this.manuallyPositioned = true;
  }

  private onDragEnd() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.cursor = "pointer";
  }

  private updateTexture() {
    const renderer = sharedRenderer;
    if (!renderer) return;
    this.characterSprite.texture = renderer.getTexture(
      this.role,
      this.animState,
      this.frameIndex
    );
  }

  private drawTrail() {
    this.trail.clear();
    const len = this.trailHistory.length;
    if (len < 3) return;
    const curr = this.trailHistory[len - 1];

    for (let i = 0; i < len - 1; i++) {
      const progress = i / len;
      const [tx, ty] = this.trailHistory[i];
      const relX = tx - curr[0];
      const relY = ty - curr[1];

      // Footprint: alternating left/right offset
      const side = i % 2 === 0 ? -1 : 1;
      const offsetX = side * 2;

      // Size grows from tail to head
      const footSize = 1.0 + progress * 1.5;

      // Alpha with phosphorescent pulse
      const baseAlpha = progress * 0.5;
      const phosphor = 0.05 * Math.sin(this.time * 0.03 + i * 0.5);
      const alpha = Math.max(0, baseAlpha + phosphor);

      // Main footprint dot
      this.trail
        .circle(relX + offsetX, relY, footSize)
        .fill({ color: this.color, alpha });

      // Phosphorescent glow for recent trail (last 30%)
      if (progress > 0.7) {
        const glowAlpha = (progress - 0.7) / 0.3 * 0.15 + phosphor * 0.5;
        this.trail
          .circle(relX + offsetX, relY, footSize * 2.5)
          .fill({ color: this.color, alpha: Math.max(0, glowAlpha) });
      }
    }
  }

  private drawActionRing(speed: number) {
    const pulse = Math.sin(this.time * speed) * 0.5 + 0.5;
    const r = CHAR_WIDTH / 2 + 2;

    this.actionRing.clear();

    // MCP summoning circle — rotating pentagram
    if (this.currentAction === "network" && this.currentDetail?.startsWith("summoning")) {
      const rotation = this.time * 0.02;
      const sr = r + 8;
      // Outer circle
      this.actionRing.circle(0, 0, sr).stroke({
        color: 0x8b6baf, width: 1.5, alpha: 0.4 + pulse * 0.3,
      });
      // Inner circle
      this.actionRing.circle(0, 0, sr * 0.6).stroke({
        color: 0x8b6baf, width: 1, alpha: 0.3 + pulse * 0.2,
      });
      // Pentagram: connect every-other vertex of 5 points
      for (let i = 0; i < 5; i++) {
        const a1 = rotation + (i * Math.PI * 2) / 5;
        const a2 = rotation + (((i + 2) % 5) * Math.PI * 2) / 5;
        const x1 = Math.cos(a1) * sr;
        const y1 = Math.sin(a1) * sr;
        const x2 = Math.cos(a2) * sr;
        const y2 = Math.sin(a2) * sr;
        this.actionRing
          .moveTo(x1, y1).lineTo(x2, y2)
          .stroke({ color: 0x8b6baf, width: 1.5, alpha: 0.5 + pulse * 0.3 });
      }
      // Orbiting sparkles
      for (let i = 0; i < 3; i++) {
        const sa = rotation * 2 + (i * Math.PI * 2) / 3;
        const sx = Math.cos(sa) * (sr + 3);
        const sy = Math.sin(sa) * (sr + 3);
        this.actionRing
          .circle(sx, sy, 1.5)
          .fill({ color: 0xdbdee1, alpha: 0.6 + pulse * 0.4 });
      }
      return;
    }

    if (this.currentAction === "test") {
      // Combat: rotating segments
      const segments = 6;
      const arcLen = (Math.PI * 2) / segments / 2;
      const rotation = this.time * 0.04;
      for (let i = 0; i < segments; i++) {
        const angle = rotation + (i * Math.PI * 2) / segments;
        this.actionRing
          .arc(0, 0, r + 5, angle, angle + arcLen)
          .stroke({ color: this.color, width: 2, alpha: 0.5 });
      }
    } else if (this.currentAction === "error") {
      this.actionRing.circle(0, 0, r + 4).stroke({
        color: THEME.statusFailed,
        width: 2,
        alpha: pulse,
      });
    } else if (this.currentAction === "build") {
      const expandR = r + 3 + pulse * 8;
      this.actionRing.circle(0, 0, expandR).stroke({
        color: this.color,
        width: 1.5,
        alpha: 1 - pulse * 0.8,
      });
    } else if (this.currentAction === "git") {
      const offset = (this.time * 0.8) % 20;
      for (let i = 0; i < 3; i++) {
        const x = r + 6 + i * 8 - offset;
        if (x > r) {
          this.actionRing
            .moveTo(x, -4).lineTo(x + 4, 0).lineTo(x, 4)
            .stroke({ color: this.color, width: 1.5, alpha: 0.4 });
        }
      }
    }
  }

  private drawBlockedRing() {
    const blink = Math.sin(this.time * 0.05) > 0 ? 0.7 : 0.3;
    const r = CHAR_WIDTH / 2 + 2;

    this.actionRing.clear();
    this.actionRing.circle(0, 0, r).stroke({
      color: THEME.statusBlocked,
      width: 2,
      alpha: blink,
    });

    // X mark
    const s = 7;
    this.actionRing
      .moveTo(-s, -s).lineTo(s, s)
      .stroke({ color: THEME.statusFailed, width: 2.5 });
    this.actionRing
      .moveTo(s, -s).lineTo(-s, s)
      .stroke({ color: THEME.statusFailed, width: 2.5 });
  }
}
