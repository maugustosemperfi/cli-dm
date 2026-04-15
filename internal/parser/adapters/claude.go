package adapters

import (
	"regexp"
	"strings"
	"sync"

	"github.com/marcosaugustodev/cli-dm/internal/mapper"
	"github.com/marcosaugustodev/cli-dm/internal/parser"
	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

// Claude parses Claude Code CLI stdout into structured events.
//
// Claude Code output is not machine-stable, so this adapter is intentionally
// permissive: unknown lines produce no events (raw output still flows via
// the ingestion layer). The adapter can be iterated on independently as
// Claude Code's output format evolves.
type Claude struct {
	mu     sync.Mutex
	states map[string]*parser.AgentState
	// lineBuffers accumulate partial lines per agent until a newline arrives
	lineBuffers map[string][]byte
}

func NewClaude() *Claude {
	return &Claude{
		states:      make(map[string]*parser.AgentState),
		lineBuffers: make(map[string][]byte),
	}
}

func (c *Claude) Name() string { return "claude" }

func (c *Claude) getState(agentID string) *parser.AgentState {
	c.mu.Lock()
	defer c.mu.Unlock()
	s, ok := c.states[agentID]
	if !ok {
		s = parser.NewAgentState(agentID)
		c.states[agentID] = s
	}
	return s
}

func (c *Claude) Feed(agentID string, chunk []byte) []protocol.Event {
	c.mu.Lock()
	c.lineBuffers[agentID] = append(c.lineBuffers[agentID], chunk...)
	buf := c.lineBuffers[agentID]
	c.mu.Unlock()

	var events []protocol.Event
	state := c.getState(agentID)

	// Process complete lines
	for {
		idx := indexOf(buf, '\n')
		if idx < 0 {
			break
		}
		line := string(buf[:idx])
		buf = buf[idx+1:]

		if evts := c.parseLine(agentID, state, line); len(evts) > 0 {
			events = append(events, evts...)
		}
	}

	c.mu.Lock()
	c.lineBuffers[agentID] = buf
	c.mu.Unlock()

	return events
}

func (c *Claude) Flush(agentID string) []protocol.Event {
	c.mu.Lock()
	buf := c.lineBuffers[agentID]
	delete(c.lineBuffers, agentID)
	c.mu.Unlock()

	if len(buf) == 0 {
		return nil
	}

	state := c.getState(agentID)
	return c.parseLine(agentID, state, string(buf))
}

// --- Pattern matching ---

var (
	// Tool call patterns (Claude Code uses bullet markers)
	reToolRead  = regexp.MustCompile(`[⏺●]\s+Read\s+(.+)`)
	reToolEdit  = regexp.MustCompile(`[⏺●]\s+Edit\s+(.+)`)
	reToolWrite = regexp.MustCompile(`[⏺●]\s+Write\s+(.+)`)
	reToolBash  = regexp.MustCompile(`[⏺●]\s+Bash\s*`)
	reToolGrep  = regexp.MustCompile(`[⏺●]\s+Grep\s*`)
	reToolGlob  = regexp.MustCompile(`[⏺●]\s+Glob\s*`)
	reToolAgent = regexp.MustCompile(`[⏺●]\s+Agent\s+(.+)`)

	// Thinking indicator
	reThinking = regexp.MustCompile(`(?i)(thinking|reasoning)`)

	// Task completion
	reTaskComplete = regexp.MustCompile(`[✓✅]\s+Task\s+.*(completed|done|finished)`)

	// Agent lifecycle
	reAgentComplete = regexp.MustCompile(`Agent\s+.*completed`)
	reAgentSpawn    = regexp.MustCompile(`(?i)launch(ed|ing)\s+(agent|subagent)`)
)

func (c *Claude) parseLine(agentID string, state *parser.AgentState, line string) []protocol.Event {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return nil
	}

	var events []protocol.Event

	// Tool calls — highest priority
	if m := reToolRead.FindStringSubmatch(line); m != nil {
		r := state.Transition(protocol.ActionRead, strings.TrimSpace(m[1]))
		return r.Events
	}
	if m := reToolEdit.FindStringSubmatch(line); m != nil {
		r := state.Transition(protocol.ActionEdit, strings.TrimSpace(m[1]))
		return r.Events
	}
	if m := reToolWrite.FindStringSubmatch(line); m != nil {
		r := state.Transition(protocol.ActionEdit, strings.TrimSpace(m[1]))
		return r.Events
	}
	if reToolGrep.MatchString(line) || reToolGlob.MatchString(line) {
		r := state.Transition(protocol.ActionRead, "searching")
		return r.Events
	}
	if reToolBash.MatchString(line) {
		// Bash tool detected — next non-empty line will be classified by command content
		r := state.Transition(protocol.ActionShell, "bash")
		return r.Events
	}
	if m := reToolAgent.FindStringSubmatch(line); m != nil {
		r := state.Transition(protocol.ActionBuild, "spawning agent: "+strings.TrimSpace(m[1]))
		return r.Events
	}

	// Command classification (for lines inside Bash tool output)
	if mapper.ReGitOp.MatchString(line) {
		m := mapper.ReGitOp.FindStringSubmatch(line)
		r := state.Transition(protocol.ActionGit, "git "+m[1])
		return r.Events
	}
	if mapper.ReTestRunner.MatchString(line) {
		r := state.Transition(protocol.ActionTest, trimmed)
		return r.Events
	}
	if mapper.ReBuild.MatchString(line) {
		r := state.Transition(protocol.ActionBuild, trimmed)
		return r.Events
	}
	if mapper.ReInstall.MatchString(line) {
		r := state.Transition(protocol.ActionBuild, trimmed)
		return r.Events
	}

	// Error detection
	if mapper.ReError.MatchString(line) {
		events = append(events, state.MarkError(trimmed))
		return events
	}

	// Blocker detection
	if mapper.ReBlocked.MatchString(line) {
		events = append(events, state.MarkBlocked(protocol.BlockerDependency, "", trimmed))
		return events
	}
	if mapper.ReConflict.MatchString(line) {
		events = append(events, state.MarkBlocked(protocol.BlockerConflict, "", trimmed))
		return events
	}
	if mapper.ReRateLimit.MatchString(line) {
		events = append(events, state.MarkBlocked(protocol.BlockerTimeout, "", trimmed))
		return events
	}

	// Task/agent lifecycle
	if reTaskComplete.MatchString(line) {
		ev, _ := protocol.NewEvent(protocol.DAGNodeStatus{
			Type:   protocol.TypeDAGNodeStatus,
			NodeID: agentID, // Best guess — map to actual task ID via DAG manager
			Status: protocol.NodeCompleted,
			Ts:     protocol.NowMs(),
		})
		events = append(events, ev)
		return events
	}

	// Unknown line — no event (raw output still flows via ingestion layer)
	return nil
}

func indexOf(data []byte, b byte) int {
	for i, v := range data {
		if v == b {
			return i
		}
	}
	return -1
}
