import { Container, FederatedPointerEvent, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { ActionType, AgentRole } from "../../protocol/events";
import { AGENT_HEX, THEME } from "./theme";
import { CharacterRenderer, CHAR_WIDTH, CHAR_HEIGHT, type AnimState } from "./sprites/CharacterRenderer";
import { SpeechBubble } from "./SpeechBubble";

// Movement pattern: returns (offsetX, offsetY) from base position
type MovementFn = (t: number) => [number, number];

const MOVEMENTS: Record<string, MovementFn> = {
  idle: (t) => [
    Math.sin(t * 0.008) * 4,
    Math.cos(t * 0.006) * 3,
  ],
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

  constructor(agentId: string, role: AgentRole) {
    super();
    this.agentId = agentId;
    this.role = role;
    this.color = AGENT_HEX[role] ?? 0x8b9aab;
    this.eventMode = "static";
    this.cursor = "pointer";

    // Trail (drawn behind everything)
    this.trail = new Graphics();
    this.trail.alpha = 0.3;
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

  setName(name: string) {
    this.nameTag.text = name;
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
    this.isBlocked = blocked;
    this.isComplete = complete;
    this.alpha = complete ? 0.35 : 1;
    if (!this.greetingActive) {
      this.speechBubble.setText(action, detail);
    }
  }

  moveTo(x: number, y: number) {
    // If layout assigns a different room, clear manual positioning
    if (this.manuallyPositioned &&
        (Math.abs(x - this.layoutX) > 1 || Math.abs(y - this.layoutY) > 1)) {
      this.manuallyPositioned = false;
    }
    this.layoutX = x;
    this.layoutY = y;

    if (this.manuallyPositioned) return;
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

    // Speech bubble animation
    this.speechBubble.tick(dt);

    // Trail
    this.trailHistory.push([finalX, finalY]);
    if (this.trailHistory.length > 20) this.trailHistory.shift();
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
    if (this.trailHistory.length < 3) return;
    const curr = this.trailHistory[this.trailHistory.length - 1];
    for (let i = 0; i < this.trailHistory.length - 1; i++) {
      const alpha = (i / this.trailHistory.length) * 0.4;
      const radius = (i / this.trailHistory.length) * 2;
      const [tx, ty] = this.trailHistory[i];
      this.trail
        .circle(tx - curr[0], ty - curr[1], radius + 0.5)
        .fill({ color: this.color, alpha });
    }
  }

  private drawActionRing(speed: number) {
    const pulse = Math.sin(this.time * speed) * 0.5 + 0.5;
    const r = CHAR_WIDTH / 2 + 2;

    this.actionRing.clear();

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
