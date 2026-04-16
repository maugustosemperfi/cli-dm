package protocol

import "encoding/json"

// Event type constants
const (
	TypeAgentSpawn    = "agent.spawn"
	TypeAgentIdle     = "agent.idle"
	TypeAgentActive   = "agent.active"
	TypeAgentComplete = "agent.complete"
	TypeAgentError    = "agent.error"

	TypeActionStart = "action.start"
	TypeActionEnd   = "action.end"

	TypeBlockerHit     = "blocker.hit"
	TypeBlockerResolve = "blocker.resolve"

	TypeDAGNodeAdd    = "dag.node.add"
	TypeDAGNodeStatus = "dag.node.status"
	TypeDAGEdgeAdd    = "dag.edge.add"

	TypeRawStdout = "raw.stdout"
	TypeRawStderr = "raw.stderr"

	TypeStateSnapshot = "state.snapshot"

	TypeAgentStats = "agent.stats"

	// Command events (browser → server)
	TypeCmdAgentKill    = "cmd.agent.kill"
	TypeCmdAgentMessage = "cmd.agent.message"
	TypeCmdAgentSignal  = "cmd.agent.signal"
)

// ActionType enumerates what an agent can be doing
type ActionType string

const (
	ActionIdle     ActionType = "idle"
	ActionThinking ActionType = "thinking"
	ActionRead     ActionType = "read"
	ActionEdit     ActionType = "edit"
	ActionTest     ActionType = "test"
	ActionGit      ActionType = "git"
	ActionBuild    ActionType = "build"
	ActionShell    ActionType = "shell"
	ActionNetwork  ActionType = "network"
	ActionBlocked  ActionType = "blocked"
	ActionError    ActionType = "error"
)

// AgentRole maps to sprite classes
type AgentRole string

const (
	RoleWarrior AgentRole = "warrior"
	RoleRogue   AgentRole = "rogue"
	RoleMage    AgentRole = "mage"
	RoleRanger  AgentRole = "ranger"
	RoleCleric  AgentRole = "cleric"
	RoleBard    AgentRole = "bard"
)

// NodeStatus for DAG nodes
type NodeStatus string

const (
	NodePending    NodeStatus = "pending"
	NodeInProgress NodeStatus = "in_progress"
	NodeCompleted  NodeStatus = "completed"
	NodeFailed     NodeStatus = "failed"
	NodeBlocked    NodeStatus = "blocked"
)

// BlockerType categorizes blockers
type BlockerType string

const (
	BlockerDependency BlockerType = "dependency"
	BlockerError      BlockerType = "error"
	BlockerConflict   BlockerType = "conflict"
	BlockerTimeout    BlockerType = "timeout"
	BlockerManual     BlockerType = "manual"
)

// Event is the envelope for all event types. It uses a discriminated union
// pattern: unmarshal the Type field first, then decode the full struct.
type Event struct {
	Type string `json:"type"`
	// Embed the raw JSON so consumers can decode the specific type
	raw json.RawMessage
}

// RawJSON returns the original JSON bytes
func (e *Event) RawJSON() json.RawMessage { return e.raw }

// UnmarshalJSON implements custom unmarshaling to capture both type and raw bytes
func (e *Event) UnmarshalJSON(data []byte) error {
	e.raw = make(json.RawMessage, len(data))
	copy(e.raw, data)
	var envelope struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(data, &envelope); err != nil {
		return err
	}
	e.Type = envelope.Type
	return nil
}

// MarshalJSON returns the stored raw JSON
func (e Event) MarshalJSON() ([]byte, error) {
	if e.raw != nil {
		return e.raw, nil
	}
	return json.Marshal(struct {
		Type string `json:"type"`
	}{Type: e.Type})
}

// --- Agent lifecycle events ---

type AgentSpawn struct {
	Type    string    `json:"type"`
	AgentID string    `json:"agentId"`
	Name    string    `json:"name"`
	Role    AgentRole `json:"role"`
	Command string    `json:"command,omitempty"`
	TaskID  string    `json:"taskId,omitempty"`
	Ts      int64     `json:"ts"`
}

type AgentIdle struct {
	Type    string `json:"type"`
	AgentID string `json:"agentId"`
	Ts      int64  `json:"ts"`
}

type AgentActive struct {
	Type    string `json:"type"`
	AgentID string `json:"agentId"`
	Ts      int64  `json:"ts"`
}

type AgentComplete struct {
	Type     string `json:"type"`
	AgentID  string `json:"agentId"`
	ExitCode int    `json:"exitCode"`
	Ts       int64  `json:"ts"`
}

type AgentError struct {
	Type    string `json:"type"`
	AgentID string `json:"agentId"`
	Message string `json:"message"`
	Ts      int64  `json:"ts"`
}

// --- Action events ---

type ActionStart struct {
	Type    string     `json:"type"`
	AgentID string     `json:"agentId"`
	Action  ActionType `json:"action"`
	Detail  string     `json:"detail,omitempty"`
	Ts      int64      `json:"ts"`
}

type ActionEnd struct {
	Type    string     `json:"type"`
	AgentID string     `json:"agentId"`
	Action  ActionType `json:"action"`
	Result  string     `json:"result,omitempty"`
	Detail  string     `json:"detail,omitempty"`
	Ts      int64      `json:"ts"`
}

// --- Blocker events ---

type BlockerHit struct {
	Type        string      `json:"type"`
	AgentID     string      `json:"agentId"`
	BlockerType BlockerType `json:"blockerType"`
	BlockedBy   string      `json:"blockedBy,omitempty"`
	Detail      string      `json:"detail,omitempty"`
	Ts          int64       `json:"ts"`
}

type BlockerResolve struct {
	Type    string `json:"type"`
	AgentID string `json:"agentId"`
	Ts      int64  `json:"ts"`
}

// --- DAG events ---

type DAGNodeAdd struct {
	Type     string `json:"type"`
	NodeID   string `json:"nodeId"`
	Label    string `json:"label"`
	Assignee string `json:"assignee,omitempty"`
	Ts       int64  `json:"ts,omitempty"`
}

type DAGNodeStatus struct {
	Type   string     `json:"type"`
	NodeID string     `json:"nodeId"`
	Status NodeStatus `json:"status"`
	Ts     int64      `json:"ts,omitempty"`
}

type DAGEdgeAdd struct {
	Type string `json:"type"`
	From string `json:"from"`
	To   string `json:"to"`
	Ts   int64  `json:"ts,omitempty"`
}

// --- Agent stats (XP / Gold / Tokens) ---

type AgentStats struct {
	Type    string  `json:"type"`
	AgentID string  `json:"agentId"`
	Tokens  int64   `json:"tokens,omitempty"`
	CostUSD float64 `json:"costUsd,omitempty"`
	Ts      int64   `json:"ts"`
}

// --- Raw output events ---

type RawStdout struct {
	Type    string `json:"type"`
	AgentID string `json:"agentId"`
	Data    string `json:"data"` // base64-encoded
	Ts      int64  `json:"ts"`
}

type RawStderr struct {
	Type    string `json:"type"`
	AgentID string `json:"agentId"`
	Data    string `json:"data"` // base64-encoded
	Ts      int64  `json:"ts"`
}

// --- State snapshot (sent on WebSocket connect) ---

type AgentSnapshot struct {
	AgentID       string     `json:"agentId"`
	Name          string     `json:"name"`
	Role          AgentRole  `json:"role"`
	CurrentAction ActionType `json:"currentAction"`
	CurrentDetail string     `json:"currentDetail,omitempty"`
	IsBlocked     bool       `json:"isBlocked,omitempty"`
	ErrorCount    int        `json:"errorCount,omitempty"`
	IsComplete    bool       `json:"isComplete,omitempty"`
	ExitCode      int        `json:"exitCode,omitempty"`
}

type DAGNodeSnapshot struct {
	NodeID   string     `json:"nodeId"`
	Label    string     `json:"label"`
	Status   NodeStatus `json:"status"`
	Assignee string     `json:"assignee,omitempty"`
}

type DAGEdgeSnapshot struct {
	From string `json:"from"`
	To   string `json:"to"`
}

type DAGSnapshot struct {
	Nodes []DAGNodeSnapshot `json:"nodes"`
	Edges []DAGEdgeSnapshot `json:"edges"`
}

type StateSnapshot struct {
	Type   string          `json:"type"`
	Agents []AgentSnapshot `json:"agents"`
	DAG    DAGSnapshot     `json:"dag"`
	Ts     int64           `json:"ts"`
}

// --- Helper constructors ---

func NewEvent(v any) (Event, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return Event{}, err
	}
	var ev Event
	if err := ev.UnmarshalJSON(data); err != nil {
		return Event{}, err
	}
	return ev, nil
}

func NowMs() int64 {
	return nowMs()
}

// --- Command events (browser → server) ---

type CmdAgentKill struct {
	Type    string `json:"type"`
	AgentID string `json:"agentId"`
	Ts      int64  `json:"ts"`
}

type CmdAgentMessage struct {
	Type    string `json:"type"`
	AgentID string `json:"agentId"`
	Message string `json:"message"`
	Ts      int64  `json:"ts"`
}

type CmdAgentSignal struct {
	Type    string `json:"type"`
	AgentID string `json:"agentId"`
	Signal  string `json:"signal"` // "interrupt", "resume"
	Ts      int64  `json:"ts"`
}
