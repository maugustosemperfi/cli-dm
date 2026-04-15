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

  // Actions
  handleEvent: (event: GameEvent) => void;
  selectAgent: (agentId: string | null) => void;
  setConnected: (connected: boolean) => void;
}

const MAX_TOOL_FLOWS = 200;
const MAX_TRANSCRIPT = 1000;

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

  setConnected: (connected) => set({ connected }),

  selectAgent: (agentId) => set({ selectedAgent: agentId }),

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


    switch (event.type) {
      case "state.snapshot": {
        const agents = new Map<string, AgentState>();
        for (const snap of event.agents) {
          const existing = state.agents.get(snap.agentId);
          agents.set(snap.agentId, {
            ...snap,
            outputBuffer: [],
            xp: existing?.xp ?? 0,
            gold: existing?.gold ?? 0,
            level: existing?.level ?? 1,
            tokens: existing?.tokens ?? 0,
            prevLevel: existing?.prevLevel ?? 1,
            activityHeat: existing?.activityHeat ?? 0,
            discoveredPaths: existing?.discoveredPaths ?? new Set(),
            discoveredPathCount: existing?.discoveredPathCount ?? 0,
            lastDiscoveredPath: existing?.lastDiscoveredPath,
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
          xp: 0,
          gold: 0,
          level: 1,
          tokens: 0,
          prevLevel: 1,
          activityHeat: 0,
          discoveredPaths: new Set(),
          discoveredPathCount: 0,
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
        }
        break;
      }

      case "action.start": {
        const agents = new Map(state.agents);
        const agent = agents.get(event.agentId);
        if (agent) {
          const prevAction = agent.currentAction;

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

          agents.set(event.agentId, {
            ...agent,
            currentAction: event.action,
            currentDetail: event.detail,
            activityHeat: agent.activityHeat + 1,
            discoveredPaths,
            discoveredPathCount,
            lastDiscoveredPath,
          });
          set({ agents });

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

          const detail = event.detail ? `: ${event.detail}` : "";
          pushLog({ category: "action", agentName: agent.name, agentRole: agent.role, message: `started ${event.action}${detail}` });
          pushTranscript({ agentId: event.agentId, agentName: agent.name, agentRole: agent.role, kind: "tool_start", action: event.action, detail: event.detail });
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
          agents.set(event.agentId, {
            ...agent,
            currentAction: "idle" as ActionType,
            currentDetail: undefined,
            xp: newXP,
            prevLevel: agent.level,
            level: newLevel,
          });
          set({ agents });

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
          agents.set(event.agentId, {
            ...agent,
            tokens: agent.tokens + (event.tokens ?? 0),
            gold: agent.gold + (event.costUsd ?? 0) * 100, // cents
          });
          set({ agents });
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
        break;
      }

      case "dag.edge.add": {
        const dag = { ...state.dag };
        dag.edges = [...dag.edges, { from: event.from, to: event.to }];
        set({ dag });
        break;
      }

      // raw.stdout / raw.stderr are handled directly by TerminalPane
      // (written to xterm.js instances), not stored in global state
    }
  },
}));
