import { create } from "zustand";
import type {
  AgentSnapshot,
  DAGSnapshot,
  ActionType,
  GameEvent,
} from "../protocol/events";
import { soundManager } from "../audio/SoundManager";

// Agent color palette — maps to dungeon roles
export const AGENT_COLORS: Record<string, string> = {
  warrior: "#5b8abf",
  rogue: "#bf6b5b",
  mage: "#8b6baf",
  ranger: "#5baf7b",
  cleric: "#bfa85b",
  bard: "#8b9aab",
};

// XP awarded per action type when an action completes
const XP_TABLE: Record<string, number> = {
  read: 5,
  edit: 20,
  test: 50,
  build: 30,
  git: 15,
  shell: 10,
  network: 8,
  thinking: 3,
  idle: 0,
  blocked: 0,
  error: 5, // survived an error
};

function levelFromXP(xp: number): number {
  // Level = floor(sqrt(xp / 100)) + 1
  // L1: 0, L2: 100, L3: 400, L4: 900, L5: 1600, ...
  return Math.floor(Math.sqrt(xp / 100)) + 1;
}

export function xpForNextLevel(level: number): number {
  return level * level * 100;
}

// --- Agent Class System ---
export type AgentClass = 'scholar' | 'berserker' | 'artificer' | 'paladin' | 'necromancer' | 'architect';

export interface ActionProfile {
  recentActions: string[];  // rolling window of last 50 action types
  classType: AgentClass;
  classChangedAt: number;   // timestamp of last class change
}

export const CLASS_COLORS: Record<AgentClass, number> = {
  scholar: 0x8b6baf,
  berserker: 0xbf4040,
  artificer: 0xd4800a,
  paladin: 0xdaa520,
  necromancer: 0x4a1a6b,
  architect: 0x4070bf,
};

function calculateAgentClass(actions: string[]): AgentClass {
  if (actions.length === 0) return 'paladin';
  const total = actions.length;
  const counts: Record<string, number> = {};
  for (const a of actions) counts[a] = (counts[a] ?? 0) + 1;
  const ratio = (key: string) => (counts[key] ?? 0) / total;

  if (ratio('error') > 0.3) return 'necromancer';
  if (ratio('read') > 0.5) return 'scholar';
  if (ratio('shell') > 0.5) return 'berserker';
  if (ratio('edit') > 0.5) return 'artificer';
  if (ratio('build') + ratio('test') > 0.4) return 'architect';
  return 'paladin';
}

// --- Boss Battle System ---
export type BossDataType = 'test_hydra' | 'forge_golem' | 'siege_dragon' | 'gate_keeper';

export interface BossState {
  bossId: string;
  bossType: BossDataType;
  name: string;
  maxHP: number;
  currentHP: number;
  nodeId: string;
  agentId: string;
  isAlive: boolean;
  participants: string[];
  lootDropped: boolean;
  reason?: string;
  lastDamageTs: number;
}

const BOSS_DISPLAY_NAMES: Record<BossDataType, string> = {
  test_hydra: 'Test Hydra',
  forge_golem: 'Forge Golem',
  siege_dragon: 'Siege Dragon',
  gate_keeper: 'Gate Keeper',
};

const BOSS_MAX_HP: Record<BossDataType, number> = {
  test_hydra: 100,
  forge_golem: 80,
  siege_dragon: 150,
  gate_keeper: 50,
};

export interface AgentState extends AgentSnapshot {
  // Accumulated raw output (last N bytes for display)
  outputBuffer: string[];
  // RPG stats
  xp: number;
  gold: number; // accumulated cost in cents (costUSD * 100)
  level: number;
  tokens: number;
  prevLevel: number; // to detect level-ups
  activityHeat: number; // rolling activity counter for heatmap glow
  // Discovery doors — directories the agent has visited
  discoveredPaths: Set<string>;
  discoveredPathCount: number;
  lastDiscoveredPath?: string;
  // Activity tracking — distinguish truly idle from briefly-between-actions
  lastActiveTs: number; // timestamp of last non-idle action
  // Fog of war — rooms this agent has visited
  visitedRooms: Set<string>;
  // Achievement tracking
  achievements: Set<string>;
  totalEdits: number;
  totalBuilds: number;
  totalTests: number;
  // Agent class from behavior
  actionProfile: ActionProfile;
  // Timestamp at which `isComplete` became true — used by the retention sweep
  // to evict long-dead agents from the scene without resetting RPG stats.
  completedAt?: number;
}

export interface EventLogEntry {
  ts: number;
  category: "action" | "complete" | "error" | "blocked" | "resolve" | "dag" | "spawn";
  agentName?: string;
  agentRole?: string;
  message: string;
}

// Tool flow tracking — records action transitions between rooms for Sankey-style corridors
export interface ToolFlowEntry {
  fromNodeId: string;
  toNodeId: string;
  action: string;
  agentRole?: string;
  ts: number;
  intensity: number; // decays over time, 1.0 = fresh
}

// Transcript entry for conversation view
export interface TranscriptEntry {
  ts: number;
  agentId: string;
  agentName?: string;
  agentRole?: string;
  kind: "tool_start" | "tool_end" | "thinking" | "error" | "complete" | "spawn" | "blocked";
  action?: string;
  detail?: string;
  message?: string;
}

// Timeline segment for concurrency view
export interface TimelineSegment {
  agentId: string;
  agentName: string;
  agentRole: string;
  action: string;
  detail?: string;
  startTs: number;
  endTs?: number; // undefined = still running
}

// Error propagation tracking
export interface ErrorPropagation {
  sourceAgentId: string;
  sourceNodeId?: string;
  ts: number;
  intensity: number; // decays over time
  affectedNodes: string[];
}

// Per-room aggregate metrics for map overlay layers
export interface RoomMetrics {
  totalTokens: number;
  totalCostUSD: number;
  errorCount: number;
  actionCount: number;
  lastActionTs: number;
  lastErrorTs: number;
}

// Token burn rate tracking per room (rolling window for rate calculation)
export interface BurnRate {
  totalTokens: number;
  totalCostUSD: number;
  tokenHistory: Array<{ ts: number; tokens: number }>;
  ratePerMin: number;
}

// Room history — tracks what happened in each room for context-sensitive decorations
export interface RoomHistory {
  editCount: number;
  readCount: number;
  testCount: number;
  buildCount: number;
  totalTokens: number;
  completedSuccessfully: boolean;
  lastActionTs: number;
  errorCount: number;
}

const DEFAULT_ROOM_HISTORY: RoomHistory = {
  editCount: 0, readCount: 0, testCount: 0, buildCount: 0,
  totalTokens: 0, completedSuccessfully: false, lastActionTs: 0, errorCount: 0,
};

export type MapLayer = "default" | "cost" | "errors" | "activity" | "fog";

export interface SearchFilters {
  agentIds: string[];      // empty = all
  actionTypes: string[];   // empty = all
  timeRange: "5m" | "15m" | "1h" | "all";
}

const TIME_RANGE_MS: Record<SearchFilters["timeRange"], number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  all: Infinity,
};

const MAX_LOG_ENTRIES = 500;

// Browser notification helper
function notifyBrowser(message: string, tag: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    new Notification("CLI_DM", { body: message, tag, icon: "/favicon.ico" });
  } else if (Notification.permission !== "denied") {
    Notification.requestPermission();
  }
}

interface GameState {
  agents: Map<string, AgentState>;
  dag: DAGSnapshot;
  connected: boolean;
  selectedAgent: string | null;
  eventLog: EventLogEntry[];
  toolFlows: ToolFlowEntry[];
  transcript: TranscriptEntry[];
  timeline: TimelineSegment[];
  errorPropagations: ErrorPropagation[];
  roomMetrics: Map<string, RoomMetrics>;
  burnRates: Map<string, BurnRate>;
  roomHistory: Map<string, RoomHistory>;
  activeLayer: MapLayer;
  bosses: Map<string, BossState>;

  // Search & filter
  searchQuery: string;
  searchFilters: SearchFilters;
  focusNodeId: string | null;  // set to pan camera to a room

  // Actions
  handleEvent: (event: GameEvent) => void;
  spawnBoss: (type: BossDataType, agentId: string, nodeId: string, reason?: string) => void;
  damageBoss: (bossId: string, damage: number, agentId: string) => void;
  selectAgent: (agentId: string | null) => void;
  setConnected: (connected: boolean) => void;
  setActiveLayer: (layer: MapLayer) => void;
  setSearchQuery: (query: string) => void;
  setSearchFilters: (filters: Partial<SearchFilters>) => void;
  focusOnNode: (nodeId: string | null) => void;
  getFilteredTranscript: () => TranscriptEntry[];
  getFilteredTimeline: () => TimelineSegment[];
}

const MAX_TOOL_FLOWS = 200;
const MAX_TRANSCRIPT = 1000;

// --- localStorage persistence for RPG stats ---
interface PersistedStats {
  xp: number;
  gold: number;
  level: number;
  tokens: number;
}

const STORAGE_KEY = "cli_dm_agent_stats";

function loadPersistedStats(): Map<string, PersistedStats> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, PersistedStats>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function savePersistedStats(agents: Map<string, AgentState>): void {
  try {
    const obj: Record<string, PersistedStats> = {};
    for (const [id, a] of agents) {
      if (a.xp > 0 || a.gold > 0 || a.tokens > 0) {
        obj[id] = { xp: a.xp, gold: a.gold, level: a.level, tokens: a.tokens };
      }
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch { /* quota exceeded — silently ignore */ }
}

const _persistedStats = loadPersistedStats();

export const useGameState = create<GameState>((set, get) => ({
  agents: new Map(),
  dag: { nodes: [], edges: [] },
  connected: false,
  selectedAgent: null,
  eventLog: [],
  toolFlows: [],
  transcript: [],
  timeline: [],
  errorPropagations: [],
  roomMetrics: new Map(),
  burnRates: new Map(),
  roomHistory: new Map(),
  activeLayer: "default",
  bosses: new Map(),

  // Search & filter
  searchQuery: "",
  searchFilters: { agentIds: [], actionTypes: [], timeRange: "all" },
  focusNodeId: null,

  spawnBoss: (type, agentId, nodeId, reason) => {
    const state = get();
    // Don't spawn if a boss of this type already exists for this node
    for (const boss of state.bosses.values()) {
      if (boss.nodeId === nodeId && boss.bossType === type && boss.isAlive) return;
    }
    const bossId = `boss_${type}_${nodeId}_${Date.now()}`;
    const maxHP = BOSS_MAX_HP[type];
    const newBoss: BossState = {
      bossId,
      bossType: type,
      name: BOSS_DISPLAY_NAMES[type],
      maxHP,
      currentHP: maxHP,
      nodeId,
      agentId,
      isAlive: true,
      participants: [agentId],
      lootDropped: false,
      reason,
      lastDamageTs: 0,
    };
    const bosses = new Map(state.bosses);
    bosses.set(bossId, newBoss);
    set({ bosses });
    soundManager.playBlocked();
  },

  damageBoss: (bossId, damage, agentId) => {
    const state = get();
    const boss = state.bosses.get(bossId);
    if (!boss || !boss.isAlive) return;
    const newHP = Math.max(0, boss.currentHP - damage);
    const isAlive = newHP > 0;
    const participants = boss.participants.includes(agentId)
      ? boss.participants
      : [...boss.participants, agentId];
    const bosses = new Map(state.bosses);
    bosses.set(bossId, {
      ...boss,
      currentHP: newHP,
      isAlive,
      participants,
      lootDropped: !isAlive,
      lastDamageTs: Date.now(),
    });
    set({ bosses });
    if (!isAlive) {
      // Boss killed — award XP bonus to participants
      const agents = new Map(state.agents);
      for (const pid of participants) {
        const agent = agents.get(pid);
        if (agent) {
          const bonusXP = Math.round(boss.maxHP * 1.5);
          const newXP = agent.xp + bonusXP;
          agents.set(pid, { ...agent, xp: newXP, level: levelFromXP(newXP) });
        }
      }
      set({ agents });
      savePersistedStats(agents);
      soundManager.playComplete();
    }
  },

  setConnected: (connected) => set({ connected }),

  selectAgent: (agentId) => set({ selectedAgent: agentId }),

  setActiveLayer: (layer) => set({ activeLayer: layer }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setSearchFilters: (filters) =>
    set((s) => ({ searchFilters: { ...s.searchFilters, ...filters } })),

  focusOnNode: (nodeId) => set({ focusNodeId: nodeId }),

  getFilteredTranscript: () => {
    const { transcript, searchQuery, searchFilters } = get();
    const q = searchQuery.toLowerCase().trim();
    const now = Date.now();
    const cutoff = TIME_RANGE_MS[searchFilters.timeRange];
    return transcript.filter((e) => {
      if (searchFilters.agentIds.length > 0 && !searchFilters.agentIds.includes(e.agentId)) return false;
      if (searchFilters.actionTypes.length > 0 && e.action && !searchFilters.actionTypes.includes(e.action)) return false;
      if (cutoff !== Infinity && now - e.ts > cutoff) return false;
      if (q) {
        const text = `${e.action ?? ""} ${e.detail ?? ""} ${e.message ?? ""} ${e.agentName ?? ""}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  },

  getFilteredTimeline: () => {
    const { timeline, searchQuery, searchFilters } = get();
    const q = searchQuery.toLowerCase().trim();
    const now = Date.now();
    const cutoff = TIME_RANGE_MS[searchFilters.timeRange];
    return timeline.filter((s) => {
      if (searchFilters.agentIds.length > 0 && !searchFilters.agentIds.includes(s.agentId)) return false;
      if (searchFilters.actionTypes.length > 0 && !searchFilters.actionTypes.includes(s.action)) return false;
      if (cutoff !== Infinity && now - s.startTs > cutoff) return false;
      if (q) {
        const text = `${s.action} ${s.detail ?? ""} ${s.agentName}`.toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  },

  handleEvent: (event) => {
    const state = get();

    const pushLog = (entry: Omit<EventLogEntry, "ts">) => {
      const log = [...state.eventLog, { ...entry, ts: event.ts ?? Date.now() }];
      if (log.length > MAX_LOG_ENTRIES) log.splice(0, log.length - MAX_LOG_ENTRIES);
      set({ eventLog: log });
    };

    const pushTranscript = (entry: Omit<TranscriptEntry, "ts">) => {
      const transcript = [...state.transcript, { ...entry, ts: event.ts ?? Date.now() }];
      if (transcript.length > MAX_TRANSCRIPT) transcript.splice(0, transcript.length - MAX_TRANSCRIPT);
      set({ transcript });
    };

    // Find which DAG node an agent is assigned to
    const agentNodeId = (agentId: string): string | undefined => {
      return state.dag.nodes.find((n) => n.assignee === agentId)?.nodeId;
    };

    // Update per-room metrics for overlay layers
    const updateRoomMetrics = (agentId: string, updater: (m: RoomMetrics) => void) => {
      const nodeId = agentNodeId(agentId);
      if (!nodeId) return;
      const metrics = new Map(get().roomMetrics);
      const existing = metrics.get(nodeId) ?? {
        totalTokens: 0, totalCostUSD: 0, errorCount: 0,
        actionCount: 0, lastActionTs: 0, lastErrorTs: 0,
      };
      const updated = { ...existing };
      updater(updated);
      metrics.set(nodeId, updated);
      set({ roomMetrics: metrics });
    };

    switch (event.type) {
      case "state.snapshot": {
        const agents = new Map<string, AgentState>();
        for (const snap of event.agents) {
          const existing = state.agents.get(snap.agentId);
          agents.set(snap.agentId, {
            ...snap,
            outputBuffer: [],
            xp: existing?.xp ?? _persistedStats.get(snap.agentId)?.xp ?? 0,
            gold: existing?.gold ?? _persistedStats.get(snap.agentId)?.gold ?? 0,
            level: existing?.level ?? _persistedStats.get(snap.agentId)?.level ?? 1,
            tokens: existing?.tokens ?? _persistedStats.get(snap.agentId)?.tokens ?? 0,
            prevLevel: existing?.prevLevel ?? _persistedStats.get(snap.agentId)?.level ?? 1,
            activityHeat: existing?.activityHeat ?? 0,
            discoveredPaths: existing?.discoveredPaths ?? new Set(),
            discoveredPathCount: existing?.discoveredPathCount ?? 0,
            lastDiscoveredPath: existing?.lastDiscoveredPath,
            lastActiveTs: existing?.lastActiveTs ?? 0,
            visitedRooms: existing?.visitedRooms ?? new Set(),
            achievements: existing?.achievements ?? new Set(),
            totalEdits: existing?.totalEdits ?? 0,
            totalBuilds: existing?.totalBuilds ?? 0,
            totalTests: existing?.totalTests ?? 0,
            actionProfile: existing?.actionProfile ?? { recentActions: [], classType: 'paladin', classChangedAt: 0 },
            completedAt: existing?.completedAt,
          });
        }
        set({ agents, dag: event.dag });
        break;
      }

      case "agent.spawn": {
        const agents = new Map(state.agents);
        agents.set(event.agentId, {
          agentId: event.agentId,
          name: event.name,
          role: event.role,
          currentAction: "idle",
          errorCount: 0,
          isBlocked: false,
          isComplete: false,
          outputBuffer: [],
          xp: _persistedStats.get(event.agentId)?.xp ?? 0,
          gold: _persistedStats.get(event.agentId)?.gold ?? 0,
          level: _persistedStats.get(event.agentId)?.level ?? 1,
          tokens: _persistedStats.get(event.agentId)?.tokens ?? 0,
          prevLevel: _persistedStats.get(event.agentId)?.level ?? 1,
          activityHeat: 0,
          lastActiveTs: 0,
          discoveredPaths: new Set(),
          discoveredPathCount: 0,
          visitedRooms: new Set(),
          achievements: new Set(),
          totalEdits: 0,
          totalBuilds: 0,
          totalTests: 0,
          actionProfile: { recentActions: [], classType: 'paladin', classChangedAt: 0 },
        });
        set({ agents });
        pushLog({ category: "spawn", agentName: event.name, agentRole: event.role, message: `joined the dungeon as ${event.role}` });
        pushTranscript({ agentId: event.agentId, agentName: event.name, agentRole: event.role, kind: "spawn", message: `joined the dungeon as ${event.role}` });
        break;
      }

      case "agent.complete": {
        const agents = new Map(state.agents);
        const agent = agents.get(event.agentId);
        if (agent) {
          agents.set(event.agentId, {
            ...agent,
            isComplete: true,
            exitCode: event.exitCode,
            currentAction: "idle",
            completedAt: event.ts ?? Date.now(),
          });
          set({ agents });
          // Close any open timeline segment
          const tl = state.timeline;
          const openSeg = tl.findLast((s) => s.agentId === event.agentId && !s.endTs);
          if (openSeg) {
            openSeg.endTs = event.ts ?? Date.now();
            set({ timeline: [...tl] });
          }
          soundManager.playComplete();
          pushLog({ category: "complete", agentName: agent.name, agentRole: agent.role, message: `completed (exit ${event.exitCode})` });
          pushTranscript({ agentId: event.agentId, agentName: agent.name, agentRole: agent.role, kind: "complete", message: `completed (exit ${event.exitCode})` });
          notifyBrowser(`${agent.name} completed their quest!`, "complete-" + event.agentId);
        }
        break;
      }

      case "agent.error": {
        const agents = new Map(state.agents);
        const agent = agents.get(event.agentId);
        if (agent) {
          agents.set(event.agentId, {
            ...agent,
            errorCount: (agent.errorCount ?? 0) + 1,
          });
          set({ agents });
          soundManager.playError();
          pushLog({ category: "error", agentName: agent.name, agentRole: agent.role, message: event.message ?? "hit an error" });
          pushTranscript({ agentId: event.agentId, agentName: agent.name, agentRole: agent.role, kind: "error", message: event.message ?? "hit an error" });
          notifyBrowser(`${agent.name} hit an error!`, "error-" + event.agentId);

          // Room metrics: track error
          updateRoomMetrics(event.agentId, (m) => {
            m.errorCount++;
            m.lastErrorTs = event.ts ?? Date.now();
          });

          // Error propagation — find connected nodes and spread fire
          const srcNode = agentNodeId(event.agentId);
          if (srcNode) {
            const affected: string[] = [srcNode];
            // Find downstream nodes via DAG edges
            for (const edge of state.dag.edges) {
              if (edge.from === srcNode) affected.push(edge.to);
            }
            // Decay old propagations and add new one
            const now = event.ts ?? Date.now();
            const props = state.errorPropagations
              .map((p) => ({ ...p, intensity: p.intensity * Math.max(0, 1 - (now - p.ts) / 30000) }))
              .filter((p) => p.intensity > 0.01);
            props.push({
              sourceAgentId: event.agentId,
              sourceNodeId: srcNode,
              ts: now,
              intensity: 1.0,
              affectedNodes: affected,
            });
            if (props.length > 20) props.splice(0, props.length - 20);
            set({ errorPropagations: props });
          }

          // Room history: track error
          const errNodeId = agentNodeId(event.agentId);
          if (errNodeId) {
            const roomHistory = new Map(state.roomHistory);
            const rh = { ...(roomHistory.get(errNodeId) ?? DEFAULT_ROOM_HISTORY) };
            rh.errorCount++;
            roomHistory.set(errNodeId, rh);
            set({ roomHistory });
          }
        }
        break;
      }

      case "action.start": {
        const agents = new Map(state.agents);
        const agent = agents.get(event.agentId);
        if (agent) {
          const prevAction = agent.currentAction;

          // One-shot SFX for the action (no ambient layering).
          soundManager.playActionSound(event.action);

          // Discovery tracking — detect new directories on read/edit
          let { discoveredPaths, discoveredPathCount, lastDiscoveredPath } = agent;
          if ((event.action === "read" || event.action === "edit") && event.detail) {
            const parts = event.detail.split("/");
            if (parts.length > 1) {
              const dir = parts.slice(0, -1).join("/");
              if (dir && !discoveredPaths.has(dir)) {
                discoveredPaths = new Set(discoveredPaths);
                discoveredPaths.add(dir);
                discoveredPathCount = discoveredPaths.size;
                const segments = dir.split("/").filter(Boolean);
                lastDiscoveredPath = segments.slice(-2).join("/");
              }
            }
          }

          // Visit tracking for fog of war
          let { visitedRooms } = agent;
          const visitedNodeId = agentNodeId(event.agentId);
          if (visitedNodeId && !visitedRooms.has(visitedNodeId)) {
            visitedRooms = new Set(visitedRooms);
            visitedRooms.add(visitedNodeId);
          }

          agents.set(event.agentId, {
            ...agent,
            currentAction: event.action,
            currentDetail: event.detail,
            activityHeat: agent.activityHeat + 1,
            lastActiveTs: event.ts ?? Date.now(),
            discoveredPaths,
            discoveredPathCount,
            lastDiscoveredPath,
            visitedRooms,
          });
          set({ agents });

          // Room metrics: track action count and recency
          updateRoomMetrics(event.agentId, (m) => {
            m.actionCount++;
            m.lastActionTs = event.ts ?? Date.now();
          });

          // Tool flow: track transition from previous action's node
          const currNodeId = agentNodeId(event.agentId);
          if (currNodeId && prevAction !== "idle" && prevAction !== event.action) {
            const flows = [...state.toolFlows, {
              fromNodeId: currNodeId,
              toNodeId: currNodeId, // same room, different action phase
              action: event.action,
              agentRole: agent.role,
              ts: event.ts ?? Date.now(),
              intensity: 1.0,
            }];
            if (flows.length > MAX_TOOL_FLOWS) flows.splice(0, flows.length - MAX_TOOL_FLOWS);
            set({ toolFlows: flows });
          }

          // Timeline: close previous segment, open new one
          const tl = [...state.timeline];
          const openSeg = tl.findLast((s) => s.agentId === event.agentId && !s.endTs);
          if (openSeg) openSeg.endTs = event.ts ?? Date.now();
          tl.push({
            agentId: event.agentId,
            agentName: agent.name,
            agentRole: agent.role,
            action: event.action,
            detail: event.detail,
            startTs: event.ts ?? Date.now(),
          });
          set({ timeline: tl });

          // Room history: track action start time
          const startNodeId = agentNodeId(event.agentId);
          if (startNodeId) {
            const roomHistory = new Map(state.roomHistory);
            const rh = { ...(roomHistory.get(startNodeId) ?? DEFAULT_ROOM_HISTORY) };
            rh.lastActionTs = event.ts ?? Date.now();
            roomHistory.set(startNodeId, rh);
            set({ roomHistory });
          }

          const detail = event.detail ? `: ${event.detail}` : "";
          pushLog({ category: "action", agentName: agent.name, agentRole: agent.role, message: `started ${event.action}${detail}` });
          pushTranscript({ agentId: event.agentId, agentName: agent.name, agentRole: agent.role, kind: "tool_start", action: event.action, detail: event.detail });

          // Boss spawning based on action type
          const bossSpawnNode = agentNodeId(event.agentId);
          if (bossSpawnNode) {
            if (event.action === "test") {
              get().spawnBoss('test_hydra', event.agentId, bossSpawnNode);
            } else if (event.action === "build") {
              get().spawnBoss('forge_golem', event.agentId, bossSpawnNode);
            }
          }
        }
        break;
      }

      case "action.end": {
        const agents = new Map(state.agents);
        const agent = agents.get(event.agentId);
        if (agent) {
          // Award XP for completed action
          const xpGain = XP_TABLE[agent.currentAction] ?? 1;
          const newXP = agent.xp + xpGain;
          const newLevel = levelFromXP(newXP);
          // Increment action counters for achievements
          const totalEdits = agent.totalEdits + (agent.currentAction === "edit" ? 1 : 0);
          const totalBuilds = agent.totalBuilds + (agent.currentAction === "build" ? 1 : 0);
          const totalTests = agent.totalTests + (agent.currentAction === "test" ? 1 : 0);
          // Update action profile for class system
          const completedAction = agent.currentAction;
          const recentActions = [...agent.actionProfile.recentActions, completedAction];
          if (recentActions.length > 50) recentActions.splice(0, recentActions.length - 50);
          let actionProfile = agent.actionProfile;
          if (recentActions.length % 10 === 0 || recentActions.length <= 3) {
            const newClass = calculateAgentClass(recentActions);
            actionProfile = {
              recentActions,
              classType: newClass,
              classChangedAt: newClass !== agent.actionProfile.classType ? Date.now() : agent.actionProfile.classChangedAt,
            };
          } else {
            actionProfile = { ...agent.actionProfile, recentActions };
          }
          agents.set(event.agentId, {
            ...agent,
            currentAction: "idle" as ActionType,
            currentDetail: undefined,
            xp: newXP,
            prevLevel: agent.level,
            level: newLevel,
            totalEdits,
            totalBuilds,
            totalTests,
            actionProfile,
          });
          set({ agents });
          savePersistedStats(agents);

          // Boss damage — find active boss in this agent's room
          const bossNodeId = agentNodeId(event.agentId);
          if (bossNodeId) {
            for (const boss of get().bosses.values()) {
              if (!boss.isAlive) continue;
              if (boss.nodeId === bossNodeId || boss.bossType === 'siege_dragon') {
                let damage = 0;
                if (boss.bossType === 'test_hydra' && completedAction === 'test') {
                  damage = 20 + Math.floor(Math.random() * 15);
                } else if (boss.bossType === 'forge_golem' && completedAction === 'build') {
                  damage = 25 + Math.floor(Math.random() * 15);
                } else if (boss.bossType === 'siege_dragon') {
                  damage = 10 + Math.floor(Math.random() * 10);
                }
                if (damage > 0) {
                  get().damageBoss(boss.bossId, damage, event.agentId);
                }
              }
            }
          }

          // Room history: track completed action type
          const endNodeId = agentNodeId(event.agentId);
          if (endNodeId) {
            const roomHistory = new Map(state.roomHistory);
            const rh = { ...(roomHistory.get(endNodeId) ?? DEFAULT_ROOM_HISTORY) };
            if (agent.currentAction === "edit") rh.editCount++;
            if (agent.currentAction === "read") rh.readCount++;
            if (agent.currentAction === "test") rh.testCount++;
            if (agent.currentAction === "build") rh.buildCount++;
            rh.lastActionTs = event.ts ?? Date.now();
            roomHistory.set(endNodeId, rh);
            set({ roomHistory });
          }

          // Timeline: close open segment
          const tl = state.timeline;
          const openSeg = tl.findLast((s) => s.agentId === event.agentId && !s.endTs);
          if (openSeg) {
            openSeg.endTs = event.ts ?? Date.now();
            set({ timeline: [...tl] });
          }

          pushTranscript({ agentId: event.agentId, agentName: agent.name, agentRole: agent.role, kind: "tool_end", action: agent.currentAction, detail: event.detail });

          // Level up notification + sound
          if (newLevel > agent.level) {
            pushLog({ category: "action", agentName: agent.name, agentRole: agent.role, message: `LEVEL UP! Now level ${newLevel}` });
            notifyBrowser(`${agent.name} leveled up to ${newLevel}!`, "level-up");
            soundManager.playLevelUp();
          }
        }
        break;
      }

      case "agent.stats": {
        const agents = new Map(state.agents);
        const agent = agents.get(event.agentId);
        if (agent) {
          const tokensAdded = event.tokens ?? 0;
          const costAdded = event.costUsd ?? 0;
          agents.set(event.agentId, {
            ...agent,
            tokens: agent.tokens + tokensAdded,
            gold: agent.gold + costAdded * 100, // cents
          });
          set({ agents });
          savePersistedStats(agents);

          // Room metrics: track tokens and cost
          updateRoomMetrics(event.agentId, (m) => {
            m.totalTokens += tokensAdded;
            m.totalCostUSD += costAdded;
          });

          // Room history: track tokens
          const statsNodeId = agentNodeId(event.agentId);
          if (statsNodeId && tokensAdded > 0) {
            const roomHistory = new Map(state.roomHistory);
            const rh = { ...(roomHistory.get(statsNodeId) ?? DEFAULT_ROOM_HISTORY) };
            rh.totalTokens += tokensAdded;
            roomHistory.set(statsNodeId, rh);
            set({ roomHistory });
          }

          // Burn rate tracking per node
          if (tokensAdded > 0) {
            const nodeId = agentNodeId(event.agentId);
            if (nodeId) {
              const burnRates = new Map(state.burnRates);
              const existing = burnRates.get(nodeId) ?? {
                totalTokens: 0, totalCostUSD: 0, tokenHistory: [], ratePerMin: 0,
              };
              const now = event.ts ?? Date.now();
              const estimatedCost = costAdded > 0
                ? costAdded
                : tokensAdded * 9 / 1_000_000; // rough average estimate
              const history = [
                ...existing.tokenHistory,
                { ts: now, tokens: tokensAdded },
              ].filter((h) => now - h.ts < 60_000); // keep last 60s
              const ratePerMin = history.reduce((s, h) => s + h.tokens, 0);
              burnRates.set(nodeId, {
                totalTokens: existing.totalTokens + tokensAdded,
                totalCostUSD: existing.totalCostUSD + estimatedCost,
                tokenHistory: history,
                ratePerMin,
              });
              set({ burnRates });
            }
          }
        }
        break;
      }

      case "blocker.hit": {
        const agents = new Map(state.agents);
        const agent = agents.get(event.agentId);
        if (agent) {
          agents.set(event.agentId, {
            ...agent,
            isBlocked: true,
            currentAction: "blocked" as ActionType,
            currentDetail: event.detail,
          });
          set({ agents });
          soundManager.playBlocked();
          pushLog({ category: "blocked", agentName: agent.name, agentRole: agent.role, message: `blocked: ${event.detail ?? "unknown reason"}` });
          pushTranscript({ agentId: event.agentId, agentName: agent.name, agentRole: agent.role, kind: "blocked", detail: event.detail ?? "unknown reason" });
          notifyBrowser(`${agent.name} is blocked!`, "blocked-" + event.agentId);

          // Spawn gate_keeper boss for blocker
          const blockerNode = agentNodeId(event.agentId);
          if (blockerNode) {
            get().spawnBoss('gate_keeper', event.agentId, blockerNode, event.detail);
          }
        }
        break;
      }

      case "blocker.resolve": {
        const agents = new Map(state.agents);
        const agent = agents.get(event.agentId);
        if (agent) {
          agents.set(event.agentId, {
            ...agent,
            isBlocked: false,
            currentAction: "idle" as ActionType,
          });
          set({ agents });
          pushLog({ category: "resolve", agentName: agent.name, agentRole: agent.role, message: "blocker resolved" });

          // Kill gate_keeper boss when blocker resolves
          const resolveNode = agentNodeId(event.agentId);
          if (resolveNode) {
            for (const boss of get().bosses.values()) {
              if (boss.bossType === 'gate_keeper' && boss.nodeId === resolveNode && boss.isAlive) {
                get().damageBoss(boss.bossId, boss.currentHP, event.agentId);
              }
            }
          }
        }
        break;
      }

      case "dag.node.add": {
        const dag = { ...state.dag };
        dag.nodes = [
          ...dag.nodes,
          {
            nodeId: event.nodeId,
            label: event.label,
            status: "pending",
            assignee: event.assignee,
          },
        ];
        set({ dag });
        break;
      }

      case "dag.node.status": {
        const dag = { ...state.dag };
        const node = dag.nodes.find((n) => n.nodeId === event.nodeId);
        dag.nodes = dag.nodes.map((n) =>
          n.nodeId === event.nodeId ? { ...n, status: event.status } : n
        );
        set({ dag });
        pushLog({ category: "dag", message: `Task '${node?.label ?? event.nodeId}' → ${event.status}` });

        // Room history: track completion
        if (event.status === "completed") {
          const roomHistory = new Map(state.roomHistory);
          const rh = { ...(roomHistory.get(event.nodeId) ?? DEFAULT_ROOM_HISTORY) };
          rh.completedSuccessfully = true;
          roomHistory.set(event.nodeId, rh);
          set({ roomHistory });
        }
        break;
      }

      case "dag.edge.add": {
        const dag = { ...state.dag };
        dag.edges = [...dag.edges, { from: event.from, to: event.to }];
        set({ dag });
        break;
      }

      case "raw.stdout":
      case "raw.stderr": {
        // Decode base64 and push as transcript entries
        try {
          const decoded = atob(event.data);
          // Strip ANSI escape codes for display
          const clean = decoded.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
          if (clean.length === 0) break;

          // Split into lines and push each as a transcript entry
          const lines = clean.split(/\r?\n/).filter(l => l.trim().length > 0);
          const agent = state.agents.get(event.agentId);
          const newEntries = lines.slice(0, 5).map(line => ({  // cap at 5 lines per chunk
            ts: event.ts ?? Date.now(),
            agentId: event.agentId,
            agentName: agent?.name,
            agentRole: agent?.role,
            kind: "tool_end" as const,  // use tool_end kind for dimmed styling
            action: event.type === "raw.stderr" ? "stderr" : "stdout",
            detail: line.slice(0, 200),  // truncate long lines
          }));

          const transcript = [...state.transcript, ...newEntries];
          if (transcript.length > MAX_TRANSCRIPT) transcript.splice(0, transcript.length - MAX_TRANSCRIPT);
          set({ transcript });
        } catch { /* ignore decode errors */ }
        break;
      }
    }
  },
}));

// --- Completed-agent retention sweep ---
// Agents marked isComplete sit in state.agents forever by default, which
// over a long-running session accumulates dead sprites and bloats memory.
// Every minute, evict agents that completed more than 30 minutes ago.
// RPG stats persist separately in localStorage via savePersistedStats, so
// stats are preserved even though the live-session entry is removed.
const COMPLETED_RETENTION_MS = 30 * 60_000;
const RETENTION_SWEEP_INTERVAL_MS = 60_000;

if (typeof window !== "undefined") {
  setInterval(() => {
    const { agents } = useGameState.getState();
    const now = Date.now();
    let evicted = 0;
    let next: Map<string, AgentState> | null = null;
    for (const [id, a] of agents) {
      if (a.isComplete && a.completedAt && now - a.completedAt > COMPLETED_RETENTION_MS) {
        if (!next) next = new Map(agents);
        next.delete(id);
        evicted++;
      }
    }
    if (next) {
      useGameState.setState({ agents: next });
    }
  }, RETENTION_SWEEP_INTERVAL_MS);
}
