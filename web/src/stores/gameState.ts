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

export interface AgentState extends AgentSnapshot {
  // Accumulated raw output (last N bytes for display)
  outputBuffer: string[];
}

export interface EventLogEntry {
  ts: number;
  category: "action" | "complete" | "error" | "blocked" | "resolve" | "dag" | "spawn";
  agentName?: string;
  agentRole?: string;
  message: string;
}

const MAX_LOG_ENTRIES = 500;

interface GameState {
  agents: Map<string, AgentState>;
  dag: DAGSnapshot;
  connected: boolean;
  selectedAgent: string | null;
  eventLog: EventLogEntry[];

  // Actions
  handleEvent: (event: GameEvent) => void;
  selectAgent: (agentId: string | null) => void;
  setConnected: (connected: boolean) => void;
}

export const useGameState = create<GameState>((set, get) => ({
  agents: new Map(),
  dag: { nodes: [], edges: [] },
  connected: false,
  selectedAgent: null,
  eventLog: [],

  setConnected: (connected) => set({ connected }),

  selectAgent: (agentId) => set({ selectedAgent: agentId }),

  handleEvent: (event) => {
    const state = get();

    const pushLog = (entry: Omit<EventLogEntry, "ts">) => {
      const log = [...state.eventLog, { ...entry, ts: event.ts ?? Date.now() }];
      if (log.length > MAX_LOG_ENTRIES) log.splice(0, log.length - MAX_LOG_ENTRIES);
      set({ eventLog: log });
    };


    switch (event.type) {
      case "state.snapshot": {
        const agents = new Map<string, AgentState>();
        for (const snap of event.agents) {
          agents.set(snap.agentId, { ...snap, outputBuffer: [] });
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
        });
        set({ agents });
        pushLog({ category: "spawn", agentName: event.name, agentRole: event.role, message: `joined the dungeon as ${event.role}` });
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
          soundManager.playComplete();
          pushLog({ category: "complete", agentName: agent.name, agentRole: agent.role, message: `completed (exit ${event.exitCode})` });
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
        }
        break;
      }

      case "action.start": {
        const agents = new Map(state.agents);
        const agent = agents.get(event.agentId);
        if (agent) {
          agents.set(event.agentId, {
            ...agent,
            currentAction: event.action,
            currentDetail: event.detail,
          });
          set({ agents });
          const detail = event.detail ? `: ${event.detail}` : "";
          pushLog({ category: "action", agentName: agent.name, agentRole: agent.role, message: `started ${event.action}${detail}` });
        }
        break;
      }

      case "action.end": {
        const agents = new Map(state.agents);
        const agent = agents.get(event.agentId);
        if (agent) {
          agents.set(event.agentId, {
            ...agent,
            currentAction: "idle" as ActionType,
            currentDetail: undefined,
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
