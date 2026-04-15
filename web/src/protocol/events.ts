// Event protocol types — mirrors protocol/events.schema.json and Go types

export type ActionType =
  | "idle"
  | "thinking"
  | "read"
  | "edit"
  | "test"
  | "git"
  | "build"
  | "shell"
  | "network"
  | "blocked"
  | "error";

export type AgentRole =
  | "warrior"
  | "rogue"
  | "mage"
  | "ranger"
  | "cleric"
  | "bard";

export type NodeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked";

export type BlockerType =
  | "dependency"
  | "error"
  | "conflict"
  | "timeout"
  | "manual";

// --- Agent lifecycle ---

export interface AgentSpawn {
  type: "agent.spawn";
  agentId: string;
  name: string;
  role: AgentRole;
  command?: string;
  taskId?: string;
  ts: number;
}

export interface AgentIdle {
  type: "agent.idle";
  agentId: string;
  ts: number;
}

export interface AgentActive {
  type: "agent.active";
  agentId: string;
  ts: number;
}

export interface AgentComplete {
  type: "agent.complete";
  agentId: string;
  exitCode: number;
  ts: number;
}

export interface AgentError {
  type: "agent.error";
  agentId: string;
  message: string;
  ts: number;
}

// --- Actions ---

export interface ActionStart {
  type: "action.start";
  agentId: string;
  action: ActionType;
  detail?: string;
  ts: number;
}

export interface ActionEnd {
  type: "action.end";
  agentId: string;
  action: ActionType;
  result?: "pass" | "fail" | "unknown";
  detail?: string;
  ts: number;
}

// --- Blockers ---

export interface BlockerHit {
  type: "blocker.hit";
  agentId: string;
  blockerType: BlockerType;
  blockedBy?: string;
  detail?: string;
  ts: number;
}

export interface BlockerResolve {
  type: "blocker.resolve";
  agentId: string;
  ts: number;
}

// --- DAG ---

export interface DAGNodeAdd {
  type: "dag.node.add";
  nodeId: string;
  label: string;
  assignee?: string;
  ts?: number;
}

export interface DAGNodeStatus {
  type: "dag.node.status";
  nodeId: string;
  status: NodeStatus;
  ts?: number;
}

export interface DAGEdgeAdd {
  type: "dag.edge.add";
  from: string;
  to: string;
  ts?: number;
}

// --- Agent stats (XP/Gold) ---

export interface AgentStatsEvent {
  type: "agent.stats";
  agentId: string;
  tokens?: number;
  costUsd?: number;
  ts: number;
}

// --- Raw output ---

export interface RawStdout {
  type: "raw.stdout";
  agentId: string;
  data: string; // base64-encoded
  ts: number;
}

export interface RawStderr {
  type: "raw.stderr";
  agentId: string;
  data: string; // base64-encoded
  ts: number;
}

// --- State snapshot ---

export interface AgentSnapshot {
  agentId: string;
  name: string;
  role: AgentRole;
  currentAction: ActionType;
  currentDetail?: string;
  isBlocked?: boolean;
  errorCount?: number;
  isComplete?: boolean;
  exitCode?: number;
}

export interface DAGSnapshot {
  nodes: { nodeId: string; label: string; status: NodeStatus; assignee?: string }[];
  edges: { from: string; to: string }[];
}

export interface StateSnapshot {
  type: "state.snapshot";
  agents: AgentSnapshot[];
  dag: DAGSnapshot;
  ts: number;
}

// Discriminated union of all events
export type GameEvent =
  | AgentSpawn
  | AgentIdle
  | AgentActive
  | AgentComplete
  | AgentError
  | AgentStatsEvent
  | ActionStart
  | ActionEnd
  | BlockerHit
  | BlockerResolve
  | DAGNodeAdd
  | DAGNodeStatus
  | DAGEdgeAdd
  | RawStdout
  | RawStderr
  | StateSnapshot;
