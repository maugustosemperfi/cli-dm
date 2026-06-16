package mapper

import (
	"fmt"
	"strings"
	"sync"

	"github.com/marcosaugustodev/cli-dm/internal/parser"
	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

// ToolEventKind categorizes what phase of a tool invocation we're observing.
type ToolEventKind string

const (
	ToolStart   ToolEventKind = "start"
	ToolEnd     ToolEventKind = "end"
	ToolError   ToolEventKind = "error"
	SessionLife ToolEventKind = "session"
)

// ToolEvent is the intermediate representation produced by parsers
// (stream-json, hook receiver, JSONL watcher) before being mapped to
// protocol.Event values.
type ToolEvent struct {
	Kind      ToolEventKind
	AgentID   string
	ToolName  string         // "Bash", "Read", "Edit", "Grep", "Glob", "Write", "Agent", "WebFetch", "WebSearch", etc.
	Input     map[string]any // Tool input parameters
	Output    string         // Tool output (for ToolEnd)
	IsError   bool
	ExitCode  int
	ToolUseID string
	Timestamp int64
	IsStart   bool // For SessionLife: true = spawn, false = complete
}

// Mapper converts ToolEvents into protocol.Events using per-agent state tracking.
type Mapper struct {
	mu     sync.Mutex
	states map[string]*parser.AgentState
	// Subagent tracking: toolUseID → subagentID for Agent tool calls
	activeSubagents map[string]string
	spawnedSubs     map[string]bool // subagentID → already spawned (dedup)
	subCount        int
}

// subagentRoles for round-robin assignment
var mapperSubRoles = []protocol.AgentRole{
	protocol.RoleRogue, protocol.RoleMage, protocol.RoleRanger,
	protocol.RoleCleric, protocol.RoleBard,
}

// New creates a new Mapper.
func New() *Mapper {
	return &Mapper{
		states:          make(map[string]*parser.AgentState),
		activeSubagents: make(map[string]string),
		spawnedSubs:     make(map[string]bool),
	}
}

// GetState returns (or creates) the AgentState for the given agent.
func (m *Mapper) GetState(agentID string) *parser.AgentState {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.states[agentID]
	if !ok {
		s = parser.NewAgentState(agentID)
		m.states[agentID] = s
	}
	return s
}

// PruneAgent removes all tracking state for a completed agent so long-running
// cli-dm sessions don't accumulate unbounded per-agent maps. Safe to call for
// agents that were never seen.
//
// Also drops any subagent entries whose IDs are derived from this agent
// (subID = parentID + ":" + name), since a completed parent means its
// subagents are implicitly done too.
func (m *Mapper) PruneAgent(agentID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.states, agentID)
	subPrefix := agentID + ":"
	for toolUseID, subID := range m.activeSubagents {
		if subID == agentID || strings.HasPrefix(subID, subPrefix) {
			delete(m.activeSubagents, toolUseID)
		}
	}
	for subID := range m.spawnedSubs {
		if subID == agentID || strings.HasPrefix(subID, subPrefix) {
			delete(m.spawnedSubs, subID)
		}
	}
}

// Map converts a single ToolEvent into zero or more protocol.Events.
func (m *Mapper) Map(te ToolEvent) []protocol.Event {
	switch te.Kind {
	case ToolStart:
		return m.handleToolStart(te)
	case ToolEnd:
		return m.handleToolEnd(te)
	case ToolError:
		// Treat as ToolEnd with error flag
		te.IsError = true
		return m.handleToolEnd(te)
	case SessionLife:
		return m.handleSessionLife(te)
	default:
		return nil
	}
}

func (m *Mapper) handleToolStart(te ToolEvent) []protocol.Event {
	state := m.GetState(te.AgentID)
	action, detail := mapToolName(te.ToolName, te.Input)
	r := state.Transition(action, detail)
	events := r.Events

	// API errors → also emit a blocker so the agent visually shows as stuck
	if te.ToolName == "__api_error__" {
		events = append(events, state.MarkBlocked(protocol.BlockerTimeout, "", truncate(detail, 200)))
	}

	// Agent/Subagent tool → spawn a subagent character on the map
	if (te.ToolName == "Agent" || te.ToolName == "Subagent") && te.ToolUseID != "" {
		name := extractFirstString(te.Input, "name", "description")
		if name == "" {
			name = extractString(te.Input, "title")
		}
		if name == "" {
			name = fmt.Sprintf("subagent-%d", m.subCount+1)
		}
		subID := te.AgentID + ":" + name

		// Only spawn if we haven't seen this subagent before (avoids backfill dupes)
		if !m.spawnedSubs[subID] {
			role := mapperSubRoles[m.subCount%len(mapperSubRoles)]
			m.subCount++

			spawnEv, err := protocol.NewEvent(protocol.AgentSpawn{
				Type:    protocol.TypeAgentSpawn,
				AgentID: subID,
				Name:    name,
				Role:    role,
				Ts:      protocol.NowMs(),
			})
			if err == nil {
				events = append(events, spawnEv)
			}
			m.spawnedSubs[subID] = true
		}
		m.activeSubagents[te.ToolUseID] = subID
	}

	return events
}

func (m *Mapper) handleToolEnd(te ToolEvent) []protocol.Event {
	state := m.GetState(te.AgentID)
	var events []protocol.Event

	if te.IsError {
		// Check output for specific blocker patterns
		output := te.Output
		switch {
		case ReBlocked.MatchString(output):
			events = append(events, state.MarkBlocked(protocol.BlockerDependency, "", truncate(output, 200)))
		case ReConflict.MatchString(output):
			events = append(events, state.MarkBlocked(protocol.BlockerConflict, "", truncate(output, 200)))
		case ReRateLimit.MatchString(output):
			events = append(events, state.MarkBlocked(protocol.BlockerTimeout, "", truncate(output, 200)))
		default:
			events = append(events, state.MarkError(truncate(output, 200)))
		}
	}

	// Complete subagent if this tool_result is for an Agent tool call
	if te.ToolUseID != "" {
		if subID, ok := m.activeSubagents[te.ToolUseID]; ok {
			completeEv, err := protocol.NewEvent(protocol.AgentComplete{
				Type:     protocol.TypeAgentComplete,
				AgentID:  subID,
				ExitCode: 0,
				Ts:       protocol.NowMs(),
			})
			if err == nil {
				events = append(events, completeEv)
			}
			delete(m.activeSubagents, te.ToolUseID)
			// Drop the subagent's per-agent state so it doesn't live on forever.
			// Holds m.mu internally; safe to call here (we don't hold the lock).
			m.PruneAgent(subID)
		}
	}

	// Transition to idle to end the current action
	r := state.Transition(protocol.ActionIdle, "")
	events = append(events, r.Events...)
	return events
}

func (m *Mapper) handleSessionLife(te ToolEvent) []protocol.Event {
	now := protocol.NowMs()
	if te.IsStart {
		ev, err := protocol.NewEvent(protocol.AgentSpawn{
			Type:    protocol.TypeAgentSpawn,
			AgentID: te.AgentID,
			Name:    te.AgentID,
			Role:    protocol.RoleWarrior,
			Ts:      now,
		})
		if err != nil {
			return nil
		}
		return []protocol.Event{ev}
	}
	// Session complete
	ev, err := protocol.NewEvent(protocol.AgentComplete{
		Type:     protocol.TypeAgentComplete,
		AgentID:  te.AgentID,
		ExitCode: te.ExitCode,
		Ts:       now,
	})
	if err != nil {
		return nil
	}
	m.PruneAgent(te.AgentID)
	return []protocol.Event{ev}
}

// mapToolName maps a Claude/Cursor tool name + input to an ActionType and detail string.
func mapToolName(toolName string, input map[string]any) (protocol.ActionType, string) {
	switch toolName {
	case "Read", "ReadFile":
		return protocol.ActionRead, extractFirstString(input, "file_path", "path")
	case "Grep", "rg":
		return protocol.ActionRead, extractFirstString(input, "pattern", "path")
	case "Glob":
		return protocol.ActionRead, extractFirstString(input, "pattern", "glob_pattern")
	case "SemanticSearch":
		return protocol.ActionRead, extractFirstString(input, "query", "path")
	case "Edit", "Write", "ApplyPatch", "EditNotebook", "Delete":
		return protocol.ActionEdit, extractFirstString(input, "file_path", "path", "target_file", "target_notebook")
	case "Bash", "Shell":
		return classifyBash(input)
	case "Agent", "Subagent":
		detail := extractFirstString(input, "description", "prompt")
		if detail == "" {
			detail = "spawning agent"
		}
		return protocol.ActionBuild, detail
	case "WebFetch", "CallMcpTool", "FetchMcpResource":
		return protocol.ActionNetwork, extractFirstString(input, "url", "server", "uri")
	case "WebSearch":
		return protocol.ActionNetwork, extractString(input, "query")
	case "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "SendMessage",
		"AskUserQuestion", "EnterPlanMode", "ExitPlanMode",
		"NotebookEdit", "Skill", "CronCreate", "CronDelete", "CronList",
		"TaskOutput", "TaskStop", "TodoWrite",
		"TeamCreate", "TeamDelete", "SwitchMode", "AskQuestion", "GenerateImage":
		return protocol.ActionThinking, extractDetail(toolName, input)
	case "__thinking__":
		return protocol.ActionThinking, "reasoning"
	case "__generating__":
		return protocol.ActionThinking, "generating response"
	case "__responding__":
		return protocol.ActionThinking, "writing response"
	case "__user_input__":
		return protocol.ActionThinking, "received prompt"
	case "__compact__":
		return protocol.ActionThinking, "compacting memory"
	case "__permission__":
		return protocol.ActionThinking, "awaiting permission"
	case "__api_error__":
		return protocol.ActionError, extractString(input, "message")
	case "__interrupted__":
		return protocol.ActionIdle, "interrupted by user"
	default:
		// MCP tools: mcp__server__tool_name
		if strings.HasPrefix(toolName, "mcp__") {
			parts := strings.SplitN(toolName[5:], "__", 2)
			server := parts[0]
			tool := ""
			if len(parts) > 1 {
				tool = parts[1]
			}
			detail := "summoning " + server
			if tool != "" {
				detail += ": " + tool
			}
			return protocol.ActionNetwork, detail
		}
		GetUnknownLogger().Log(UnknownEntry{
			Reason:   "unknown_tool",
			ToolName: toolName,
			RawData:  input,
		})
		return protocol.ActionShell, toolName
	}
}

// classifyBash inspects the command string in a Bash tool input and returns
// the most specific action type.
func classifyBash(input map[string]any) (protocol.ActionType, string) {
	cmd := extractString(input, "command")
	if cmd == "" {
		cmd = extractString(input, "cmd")
	}
	if cmd == "" {
		return protocol.ActionShell, "bash"
	}

	detail := truncate(cmd, 120)

	if ReGitOp.MatchString(cmd) {
		m := ReGitOp.FindStringSubmatch(cmd)
		return protocol.ActionGit, "git " + m[1]
	}
	if ReTestRunner.MatchString(cmd) {
		return protocol.ActionTest, detail
	}
	if ReBuild.MatchString(cmd) {
		return protocol.ActionBuild, detail
	}
	if ReInstall.MatchString(cmd) {
		return protocol.ActionBuild, detail
	}
	return protocol.ActionShell, detail
}

// extractString pulls a string value from a map by key, returning "" if missing or wrong type.
func extractString(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	v, ok := m[key]
	if !ok {
		return ""
	}
	s, ok := v.(string)
	if !ok {
		return fmt.Sprintf("%v", v)
	}
	return s
}

func extractFirstString(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if s := extractString(m, key); s != "" {
			return s
		}
	}
	return ""
}

// extractDetail builds a display string from tool input for task-related tools.
func extractDetail(toolName string, input map[string]any) string {
	switch toolName {
	case "TaskCreate":
		return "creating task: " + extractString(input, "subject")
	case "TaskUpdate":
		return "updating task: " + extractString(input, "taskId")
	case "TaskList":
		return "listing tasks"
	case "TaskGet":
		return "reading task: " + extractString(input, "taskId")
	case "SendMessage":
		return "sending message"
	case "TeamCreate":
		return "forming party: " + extractString(input, "team_name")
	case "TeamDelete":
		return "disbanding party"
	default:
		return toolName
	}
}

// truncate shortens a string to maxLen, appending "..." if truncated.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}
