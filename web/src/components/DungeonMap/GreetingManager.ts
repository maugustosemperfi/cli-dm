/**
 * GreetingManager — detects when two agents are near each other
 * and triggers speech bubble interactions (wave, high-five, etc.)
 */

const GREET_DISTANCE = 90;       // pixels — agents must be within this to greet
const GREET_COOLDOWN = 600;      // ticks (~10s) before the same pair can greet again
const GREET_DISPLAY_TIME = 120;  // ticks (~2s) to show the greeting bubble

const GREETINGS = [
  ["Hey!", "Hi there!"],
  ["Nice work!", "Thanks!"],
  ["Good luck!", "You too!"],
  ["High five!", "*slap*"],
  ["Looking good!", "Right back at ya!"],
  ["Need help?", "I'm good!"],
  ["Watch out!", "Got it!"],
  ["Almost done!", "Keep going!"],
  ["Teamwork!", "Let's go!"],
  ["*waves*", "*waves back*"],
  ["Found a bug!", "Oh no..."],
  ["Coffee break?", "Always!"],
];

export interface GreetingEvent {
  agent1Id: string;
  agent2Id: string;
  text1: string;   // what agent1 says
  text2: string;   // what agent2 replies
  startTick: number;
}

export class GreetingManager {
  // Track cooldowns: "id1:id2" → tick when cooldown expires
  private cooldowns = new Map<string, number>();
  private currentTick = 0;
  private activeGreetings: GreetingEvent[] = [];

  /**
   * Check all agent pairs for proximity and trigger greetings.
   * Returns list of active greetings to display.
   */
  tick(
    dt: number,
    agents: Array<{ id: string; x: number; y: number; isIdle: boolean; isComplete: boolean }>
  ): GreetingEvent[] {
    this.currentTick += dt;

    // Clean expired greetings
    this.activeGreetings = this.activeGreetings.filter(
      (g) => this.currentTick - g.startTick < GREET_DISPLAY_TIME
    );

    // Check pairs
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i];
        const b = agents[j];

        // Skip completed agents
        if (a.isComplete || b.isComplete) continue;

        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > GREET_DISTANCE) continue;

        // Check cooldown
        const pairKey = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
        const cooldownEnd = this.cooldowns.get(pairKey) ?? 0;
        if (this.currentTick < cooldownEnd) continue;

        // Already have an active greeting for this pair?
        if (this.activeGreetings.some((g) =>
          (g.agent1Id === a.id && g.agent2Id === b.id) ||
          (g.agent1Id === b.id && g.agent2Id === a.id)
        )) continue;

        // Trigger greeting!
        const [text1, text2] = GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
        this.activeGreetings.push({
          agent1Id: a.id,
          agent2Id: b.id,
          text1,
          text2,
          startTick: this.currentTick,
        });

        // Set cooldown
        this.cooldowns.set(pairKey, this.currentTick + GREET_COOLDOWN);
      }
    }

    // Clean old cooldowns
    if (this.currentTick % 1000 < dt) {
      for (const [key, end] of this.cooldowns) {
        if (this.currentTick > end + 600) {
          this.cooldowns.delete(key);
        }
      }
    }

    return this.activeGreetings;
  }
}
