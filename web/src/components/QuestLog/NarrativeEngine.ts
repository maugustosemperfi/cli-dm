/**
 * NarrativeEngine — generates RPG-flavored story snippets from game events.
 *
 * Watches event patterns and produces narrative entries for the QuestLog.
 */

import type { AgentState } from "../../stores/gameState";

export type NarrativeType =
  | "error_recovery"
  | "collaboration"
  | "boss_defeat"
  | "speed_run"
  | "marathon"
  | "exploration"
  | "level_up"
  | "session_summary";

export interface NarrativeEntry {
  id: string;
  ts: number;
  type: NarrativeType;
  icon: string;
  text: string;
}

const ICONS: Record<NarrativeType, string> = {
  error_recovery: "\u2694\uFE0F",  // crossed swords
  collaboration: "\uD83E\uDD1D",    // handshake
  boss_defeat: "\uD83D\uDC80",      // skull
  speed_run: "\u26A1",              // lightning
  marathon: "\uD83D\uDD25",         // fire
  exploration: "\uD83D\uDDFA\uFE0F", // world map
  level_up: "\u2B50",               // star
  session_summary: "\uD83D\uDCDC",   // scroll
};

// Template pools for variety
const ERROR_RECOVERY_TEMPLATES = [
  (name: string, n: number, room: string) =>
    `${name} fought through ${n} error${n > 1 ? "s" : ""} in the ${room} and emerged victorious!`,
  (name: string, n: number, room: string) =>
    `After facing ${n} dire challenge${n > 1 ? "s" : ""}, ${name} conquered the ${room}.`,
  (name: string, n: number, _room: string) =>
    `${name} survived ${n} trap${n > 1 ? "s" : ""} and pressed onward.`,
];

const COLLABORATION_TEMPLATES = [
  (room: string, n: number) =>
    `The ${room} saw heavy activity \u2014 ${n} adventurers toiled together.`,
  (room: string, n: number) =>
    `${n} heroes gathered in the ${room}, forging progress through unity.`,
];

const BOSS_DEFEAT_TEMPLATES = [
  (name: string, duration: string) =>
    `A fearsome beast was vanquished by ${name} after a ${duration} battle!`,
  (name: string, duration: string) =>
    `${name} slew the guardian after ${duration} of fierce combat.`,
];

const SPEED_RUN_TEMPLATES = [
  (name: string, room: string, time: string) =>
    `${name} blazed through the ${room} in just ${time}!`,
  (name: string, room: string, time: string) =>
    `Lightning-fast! ${name} cleared the ${room} in ${time}.`,
];

const MARATHON_TEMPLATES = [
  (room: string, duration: string) =>
    `A grueling ${duration} siege in the ${room} continues...`,
  (room: string, duration: string) =>
    `The ${room} has been contested for ${duration}. The battle rages on.`,
];

const EXPLORATION_TEMPLATES = [
  (name: string, path: string) =>
    `${name} ventured into uncharted territory \u2014 ${path}`,
  (name: string, path: string) =>
    `A hidden passage revealed! ${name} discovered ${path}.`,
];

const LEVEL_UP_TEMPLATES = [
  (name: string, level: number) =>
    `${name} has grown stronger! Level ${level} achieved.`,
  (name: string, level: number) =>
    `The power surges! ${name} ascends to level ${level}.`,
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

let nextId = 1;

// Per-agent tracking state
interface AgentTracking {
  errorsSinceSuccess: number;
  lastActionStartTs: number;
  lastRoom: string;
  reportedMarathon: boolean;
  reportedLevelUp: number;
  discoveredPathCount: number;
}

export class NarrativeEngine {
  private entries: NarrativeEntry[] = [];
  private maxEntries = 50;
  private agentTracking = new Map<string, AgentTracking>();
  // Track room occupancy for collaboration detection
  private roomAgentCount = new Map<string, Set<string>>();
  private reportedCollaborations = new Set<string>(); // "room:count" to avoid spam

  private getTracking(agentId: string): AgentTracking {
    let t = this.agentTracking.get(agentId);
    if (!t) {
      t = {
        errorsSinceSuccess: 0,
        lastActionStartTs: 0,
        lastRoom: "",
        reportedMarathon: false,
        reportedLevelUp: 0,
        discoveredPathCount: 0,
      };
      this.agentTracking.set(agentId, t);
    }
    return t;
  }

  private addEntry(type: NarrativeType, text: string): NarrativeEntry {
    const entry: NarrativeEntry = {
      id: `n-${nextId++}`,
      ts: Date.now(),
      type,
      icon: ICONS[type],
      text,
    };
    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    return entry;
  }

  /**
   * Process current agent states and detect narrative triggers.
   * Called on each game state update.
   * Returns new entries added this tick (if any).
   */
  processAgentStates(
    agents: Map<string, AgentState>,
    dagNodes: Array<{ nodeId: string; label: string; assignee?: string }>
  ): NarrativeEntry[] {
    const newEntries: NarrativeEntry[] = [];

    // Build room→agents mapping
    this.roomAgentCount.clear();
    for (const agent of agents.values()) {
      const node = dagNodes.find((n) => n.assignee === agent.agentId);
      if (node) {
        let set = this.roomAgentCount.get(node.nodeId);
        if (!set) {
          set = new Set();
          this.roomAgentCount.set(node.nodeId, set);
        }
        set.add(agent.agentId);
      }
    }

    for (const agent of agents.values()) {
      const t = this.getTracking(agent.agentId);
      const node = dagNodes.find((n) => n.assignee === agent.agentId);
      const roomLabel = node?.label ?? "unknown chamber";
      const agentName = agent.name ?? agent.agentId;

      // -- Error tracking --
      if (agent.currentAction === "error" || (agent.errorCount ?? 0) > t.errorsSinceSuccess) {
        t.errorsSinceSuccess = agent.errorCount ?? 0;
      }

      // -- Error recovery: had errors, now completed or action succeeding --
      if (t.errorsSinceSuccess >= 2 && agent.isComplete) {
        const entry = this.addEntry(
          "error_recovery",
          pick(ERROR_RECOVERY_TEMPLATES)(agentName, t.errorsSinceSuccess, roomLabel)
        );
        newEntries.push(entry);
        t.errorsSinceSuccess = 0;
      }

      // -- Speed run: action completed in < 30s (tracked on action.end → idle) --
      if (agent.currentAction === "idle" && t.lastActionStartTs > 0) {
        const elapsed = Date.now() - t.lastActionStartTs;
        if (elapsed < 30000 && elapsed > 1000 && t.lastRoom) {
          const entry = this.addEntry(
            "speed_run",
            pick(SPEED_RUN_TEMPLATES)(agentName, t.lastRoom, formatDuration(elapsed))
          );
          newEntries.push(entry);
        }
        t.lastActionStartTs = 0;
      }

      // -- Record action start time for speed run/marathon --
      if (agent.currentAction !== "idle" && agent.currentAction !== "blocked" && agent.currentAction !== "error") {
        if (t.lastActionStartTs === 0) {
          t.lastActionStartTs = agent.lastActiveTs || Date.now();
          t.lastRoom = roomLabel;
          t.reportedMarathon = false;
        }

        // -- Marathon: action ongoing > 10 min --
        const actionDuration = Date.now() - t.lastActionStartTs;
        if (actionDuration > 600_000 && !t.reportedMarathon) {
          t.reportedMarathon = true;
          const entry = this.addEntry(
            "marathon",
            pick(MARATHON_TEMPLATES)(roomLabel, formatDuration(actionDuration))
          );
          newEntries.push(entry);
        }
      }

      // -- Level up --
      if (agent.level > t.reportedLevelUp) {
        if (t.reportedLevelUp > 0) {
          // Don't report initial level
          const entry = this.addEntry(
            "level_up",
            pick(LEVEL_UP_TEMPLATES)(agentName, agent.level)
          );
          newEntries.push(entry);
        }
        t.reportedLevelUp = agent.level;
      }

      // -- Exploration --
      if (agent.discoveredPathCount > t.discoveredPathCount && agent.lastDiscoveredPath) {
        t.discoveredPathCount = agent.discoveredPathCount;
        const entry = this.addEntry(
          "exploration",
          pick(EXPLORATION_TEMPLATES)(agentName, agent.lastDiscoveredPath)
        );
        newEntries.push(entry);
      }
    }

    // -- Collaboration detection: multiple agents in same room --
    for (const [nodeId, agentSet] of this.roomAgentCount) {
      if (agentSet.size >= 2) {
        const key = `${nodeId}:${agentSet.size}`;
        if (!this.reportedCollaborations.has(key)) {
          this.reportedCollaborations.add(key);
          const node = dagNodes.find((n) => n.nodeId === nodeId);
          const roomLabel = node?.label ?? "unknown chamber";
          const entry = this.addEntry(
            "collaboration",
            pick(COLLABORATION_TEMPLATES)(roomLabel, agentSet.size)
          );
          newEntries.push(entry);
        }
      }
    }

    return newEntries;
  }

  /**
   * Record a boss defeat for narrative.
   */
  recordBossDefeat(agentName: string, durationMs: number): NarrativeEntry {
    return this.addEntry(
      "boss_defeat",
      pick(BOSS_DEFEAT_TEMPLATES)(agentName, formatDuration(durationMs))
    );
  }

  getEntries(): NarrativeEntry[] {
    return this.entries;
  }

  /**
   * Generate a session summary paragraph.
   */
  generateSummary(agents: Map<string, AgentState>): NarrativeEntry {
    const totalAgents = agents.size;
    const completedAgents = [...agents.values()].filter((a) => a.isComplete).length;
    const totalErrors = [...agents.values()].reduce((s, a) => s + (a.errorCount ?? 0), 0);
    const totalLevel = [...agents.values()].reduce((s, a) => s + a.level, 0);

    const parts: string[] = [];
    parts.push(`${totalAgents} brave adventurer${totalAgents !== 1 ? "s" : ""} ventured into the dungeon.`);
    if (completedAgents > 0) {
      parts.push(`${completedAgents} emerged victorious.`);
    }
    if (totalErrors > 0) {
      parts.push(`${totalErrors} trap${totalErrors !== 1 ? "s" : ""} were triggered along the way.`);
    }
    if (totalLevel > totalAgents) {
      parts.push(`Combined experience reached level ${totalLevel}.`);
    }
    parts.push("Thus concludes this chapter of the dungeon chronicles.");

    return this.addEntry("session_summary", parts.join(" "));
  }
}

export const narrativeEngine = new NarrativeEngine();
