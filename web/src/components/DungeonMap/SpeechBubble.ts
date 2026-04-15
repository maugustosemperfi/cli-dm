import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { ActionType } from "../../protocol/events";

const BUBBLE_MAX_WIDTH = 160;
const BUBBLE_PAD_X = 10;
const BUBBLE_PAD_Y = 6;
const TAIL_SIZE = 6;
const FONT_SIZE = 11;
const FADE_SPEED = 0.08;
const SHOW_DELAY = 30; // ~0.5s at 60fps

// Idle cry-for-help phrases — cycles through these
const IDLE_PHRASES = [
  "Anyone there?",
  "I need a quest!",
  "Hello...?",
  "Give me a task!",
  "So bored...",
  "Help needed!",
  "Waiting...",
  "Pick me!",
  "I'm available!",
  "Need orders!",
  "*yawns*",
  "Anybody home?",
  "Ready for action!",
  "Put me in, coach!",
  "*taps foot*",
  "Got any work?",
  "Standing by...",
  "Send help pls",
  "Is this thing on?",
];

// How often idle text cycles (in ticks, ~16ms each)
const IDLE_CYCLE_TICKS = 300; // ~5 seconds — slower so you can read them
// Idle bubble bobs up and down
const IDLE_BOB_SPEED = 0.025;
const IDLE_BOB_AMOUNT = 2;

function thinkingText(detail?: string): string {
  if (!detail) return "Thinking...";

  switch (detail) {
    case "reasoning":
      return "Deep in thought...";
    case "writing response":
      return "Composing scroll...";
    case "received prompt":
      return "Reading quest...";
    case "generating response":
      return "Crafting response...";
    case "listing tasks":
      return "Checking quest board...";
    case "sending message":
      return "Sending raven...";
    case "AskUserQuestion":
      return "Needs guidance...";
    case "EnterPlanMode":
      return "Drawing battle plan...";
    case "ExitPlanMode":
      return "Plan ready!";
    case "Skill":
      return "Casting spell...";
    case "NotebookEdit":
      return "Writing in grimoire...";
    case "CronCreate":
      return "Setting a timer...";
    case "compacting memory":
      return "Brain overloaded!";
    case "awaiting permission":
      return "Awaiting orders!";
    default:
      if (detail.startsWith("creating task:"))
        return `Planning: ${detail.slice(15).trim()}`;
      if (detail.startsWith("updating task:"))
        return `Quest update: ${detail.slice(15).trim()}`;
      if (detail.startsWith("reading task:"))
        return `Reviewing quest ${detail.slice(14).trim()}`;
      // Show truncated detail as-is
      const short = detail.length > 30 ? detail.slice(0, 27) + "..." : detail;
      return short;
  }
}

function actionText(action: ActionType, detail?: string): string {
  const file = detail ? detail.split("/").pop() ?? detail : "";
  switch (action) {
    case "read":
      return file ? `Reading ${file}...` : "Reading...";
    case "edit":
      return file ? `Editing ${file}` : "Editing...";
    case "test":
      return "Running tests...";
    case "build":
      return "Building...";
    case "git":
      return detail ?? "Git operation...";
    case "shell":
      return detail ? `$ ${detail.slice(0, 20)}` : "Running shell...";
    case "network":
      if (detail?.startsWith("summoning ")) {
        const server = detail.slice(10).split(":")[0];
        return `Summoning ${server}...`;
      }
      return "Fetching...";
    case "thinking":
      return thinkingText(detail);
    case "blocked":
      return "Stuck! Need help...";
    case "error":
      return "Something broke!";
    default:
      return "";
  }
}

export class SpeechBubble extends Container {
  private bg: Graphics;
  private textLabel: Text;
  private targetAlpha = 0;
  private showTimer = 0;
  private currentText = "";
  private isIdle = false;
  private idleTimer = 0;
  private idlePhraseIdx = 0;
  private baseY = 0; // for bobbing

  constructor() {
    super();
    this.alpha = 0;
    // Start each agent on a random phrase so they don't all say the same thing
    this.idlePhraseIdx = Math.floor(Math.random() * IDLE_PHRASES.length);

    this.bg = new Graphics();
    this.addChild(this.bg);

    this.textLabel = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: "monospace",
        fontSize: FONT_SIZE,
        fill: 0x2b2d31,
        wordWrap: true,
        wordWrapWidth: BUBBLE_MAX_WIDTH - BUBBLE_PAD_X * 2,
      }),
    });
    this.textLabel.anchor.set(0.5, 0);
    this.addChild(this.textLabel);
  }

  /** Force a specific text (e.g., for greetings). Bypasses action mapping. */
  forceText(text: string) {
    this.isIdle = false;
    this.idleTimer = 0;
    this.currentText = text;
    this.textLabel.text = text;
    this.textLabel.style.fill = 0xffffff; // white text
    this.redrawBg(0x2d5a2d); // dark green bubble
    this.targetAlpha = 1;
    this.alpha = 0.9; // show immediately
    this.showTimer = SHOW_DELAY; // skip delay
  }

  setText(action: ActionType, detail?: string) {
    if (action === "idle") {
      // Idle agents are silent — no speech bubble
      this.isIdle = false;
      this.targetAlpha = 0;
      return;
    }

    // Not idle anymore
    this.isIdle = false;
    this.idleTimer = 0;

    const text = actionText(action, detail);
    if (!text) {
      this.targetAlpha = 0;
      return;
    }

    if (text !== this.currentText) {
      this.currentText = text;
      this.textLabel.text = text;
      this.textLabel.style.fill = 0xffffff; // white text
      this.textLabel.style.fontSize = FONT_SIZE;
      this.showTimer = 0;
      this.redrawBg(0x3a3b40); // dark bubble — high contrast
    }

    this.targetAlpha = 1;
  }

  tick(dt: number) {
    // Idle phrase cycling
    if (this.isIdle) {
      this.idleTimer += dt;
      if (this.idleTimer >= IDLE_CYCLE_TICKS) {
        this.idleTimer = 0;
        this.idlePhraseIdx = (this.idlePhraseIdx + 1) % IDLE_PHRASES.length;
        this.setIdlePhrase();
      }

      // Bob the bubble up and down
      const bob = Math.sin(this.idleTimer * IDLE_BOB_SPEED) * IDLE_BOB_AMOUNT;
      this.position.y = this.baseY + bob;

      // Gentle alpha pulse — stays readable
      const pulse = 0.7 + Math.sin(this.idleTimer * 0.02) * 0.1;
      this.targetAlpha = pulse;
    } else {
      this.position.y = this.baseY;
    }

    // Delay before showing
    if (this.targetAlpha > 0 && this.alpha < 0.1) {
      this.showTimer += dt;
      if (this.showTimer < SHOW_DELAY) return;
    }

    // Smooth fade
    const diff = this.targetAlpha - this.alpha;
    if (Math.abs(diff) > 0.01) {
      this.alpha += diff * FADE_SPEED * dt;
    } else {
      this.alpha = this.targetAlpha;
    }
  }

  /** Set the base Y position (AgentSprite sets this) */
  setBaseY(y: number) {
    this.baseY = y;
    if (!this.isIdle) {
      this.position.y = y;
    }
  }

  private setIdlePhrase() {
    const phrase = IDLE_PHRASES[this.idlePhraseIdx];
    if (phrase !== this.currentText) {
      this.currentText = phrase;
      this.textLabel.text = phrase;
      this.textLabel.style.fill = 0xffffff; // white text on dark bubble
      this.textLabel.style.fontSize = FONT_SIZE + 1;
      this.redrawBg(0x2b2d31); // dark bubble for idle — high contrast
    }
  }

  private redrawBg(bgColor: number) {
    const textW = Math.min(this.textLabel.width, BUBBLE_MAX_WIDTH - BUBBLE_PAD_X * 2);
    const textH = this.textLabel.height;
    const w = textW + BUBBLE_PAD_X * 2;
    const h = textH + BUBBLE_PAD_Y * 2;

    this.textLabel.position.set(0, BUBBLE_PAD_Y);

    this.bg.clear();
    // Bubble body
    this.bg
      .roundRect(-w / 2, 0, w, h, 4)
      .fill({ color: bgColor, alpha: 0.95 })
      .stroke({ color: 0x6d6f78, width: 1 });

    // Tail (triangle pointing down)
    this.bg
      .moveTo(-TAIL_SIZE / 2, h)
      .lineTo(0, h + TAIL_SIZE)
      .lineTo(TAIL_SIZE / 2, h)
      .fill({ color: bgColor, alpha: 0.95 });
    this.bg
      .moveTo(-TAIL_SIZE / 2, h)
      .lineTo(0, h + TAIL_SIZE)
      .lineTo(TAIL_SIZE / 2, h)
      .stroke({ color: 0x6d6f78, width: 1 });

    // Position: bubble is above the character, tail points down
    this.pivot.set(0, h + TAIL_SIZE);
  }
}
