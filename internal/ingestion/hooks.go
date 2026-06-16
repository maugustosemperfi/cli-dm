package ingestion

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"

	"github.com/marcosaugustodev/cli-dm/internal/mapper"
	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

// agentMeta stores display metadata for a registered agent.
type agentMeta struct {
	Name string
	Role protocol.AgentRole
}

// HookReceiver is an HTTP handler that receives Claude Code hook events
// (PostToolUse, PreToolUse, SessionStart, Stop, etc.) and converts them
// into protocol events via the shared Mapper.
type HookReceiver struct {
	mp           *mapper.Mapper
	eventSink    EventSink
	logger       *slog.Logger
	mu           sync.RWMutex
	sessionMap   map[string]string    // session ID → CLI_DM agent ID
	agentInfo    map[string]agentMeta // CLI_DM agent ID → meta
	authToken    string
	nextByPrefix map[string]int // per-source agent counter ("claude", "cursor", …)
	nextSubSeq   int
}

// NewHookReceiver creates a HookReceiver. If token is non-empty, incoming
// requests must include a matching Authorization: Bearer header.
func NewHookReceiver(mp *mapper.Mapper, sink EventSink, token string, logger *slog.Logger) *HookReceiver {
	return &HookReceiver{
		mp:           mp,
		eventSink:    sink,
		logger:       logger,
		sessionMap:   make(map[string]string),
		agentInfo:    make(map[string]agentMeta),
		authToken:    token,
		nextByPrefix: make(map[string]int),
	}
}

// RegisterAgent pre-registers a known agent mapping from a Claude session ID
// to a CLI_DM agent ID with display metadata.
func (h *HookReceiver) RegisterAgent(agentID, name string, role protocol.AgentRole) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.agentInfo[agentID] = agentMeta{Name: name, Role: role}
}

// RegisterHandler returns an http.Handler for the /api/hooks/register endpoint.
func (h *HookReceiver) RegisterHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !h.checkAuth(w, r) {
			return
		}

		var req struct {
			SessionID string `json:"session_id"`
			AgentID   string `json:"agent_id"`
			Name      string `json:"name"`
			Role      string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid JSON", http.StatusBadRequest)
			return
		}

		if req.SessionID == "" || req.AgentID == "" {
			http.Error(w, "session_id and agent_id required", http.StatusBadRequest)
			return
		}

		role := protocol.AgentRole(req.Role)
		if role == "" {
			role = protocol.RoleWarrior
		}

		h.mu.Lock()
		h.sessionMap[req.SessionID] = req.AgentID
		h.agentInfo[req.AgentID] = agentMeta{Name: req.Name, Role: role}
		h.mu.Unlock()

		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"status":"registered"}`)
	})
}

// hookPayload is the expected JSON body from the hook script.
type hookPayload struct {
	HookType string         `json:"hook_type"`
	Payload  map[string]any `json:"payload"`
}

// ServeHTTP handles incoming hook events at /api/hooks.
func (h *HookReceiver) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !h.checkAuth(w, r) {
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1 MB max
	if err != nil {
		http.Error(w, "read error", http.StatusBadRequest)
		return
	}

	var hp hookPayload
	if err := json.Unmarshal(body, &hp); err != nil {
		http.Error(w, "invalid JSON", http.StatusBadRequest)
		return
	}

	agentID := h.resolveAgent(hp.Payload)

	te := h.buildToolEvent(hp.HookType, hp.Payload, agentID)
	if te == nil {
		w.WriteHeader(http.StatusOK)
		return
	}

	events := h.mp.Map(*te)
	for _, ev := range events {
		h.eventSink(ev)
	}

	w.WriteHeader(http.StatusOK)
}

// resolveAgent looks up the CLI_DM agent ID for a hook session.
// If not found, auto-creates a new agent mapping using payload.source
// ("claude" from Claude Code hooks, "cursor" from cursor-dm-relay).
func (h *HookReceiver) resolveAgent(payload map[string]any) string {
	sessionID, _ := payload["session_id"].(string)
	if sessionID == "" {
		sessionID = "default"
	}

	h.mu.RLock()
	agentID, ok := h.sessionMap[sessionID]
	h.mu.RUnlock()
	if ok {
		return agentID
	}

	// Auto-create agent
	h.mu.Lock()
	defer h.mu.Unlock()

	// Double-check after acquiring write lock
	if agentID, ok := h.sessionMap[sessionID]; ok {
		return agentID
	}

	prefix := hookSourcePrefix(payload)
	h.nextByPrefix[prefix]++
	n := h.nextByPrefix[prefix]
	agentID = fmt.Sprintf("%s-%d", prefix, n)
	h.sessionMap[sessionID] = agentID

	roles := []protocol.AgentRole{
		protocol.RoleWarrior, protocol.RoleRogue, protocol.RoleMage,
		protocol.RoleRanger, protocol.RoleCleric, protocol.RoleBard,
	}
	role := roles[(n-1)%len(roles)]
	if prefix == "cursor" {
		role = protocol.RoleMage
	} else if prefix == "claude" {
		role = protocol.RoleRogue
	}

	name := hookDisplayName(prefix, n)

	h.agentInfo[agentID] = agentMeta{Name: name, Role: role}

	// Emit spawn event
	ev, err := protocol.NewEvent(protocol.AgentSpawn{
		Type:    protocol.TypeAgentSpawn,
		AgentID: agentID,
		Name:    name,
		Role:    role,
		Ts:      protocol.NowMs(),
	})
	if err == nil {
		h.eventSink(ev)
	}

	return agentID
}

func hookSourcePrefix(payload map[string]any) string {
	if source, ok := payload["source"].(string); ok {
		source = strings.ToLower(strings.TrimSpace(source))
		if source != "" {
			return source
		}
	}
	return "claude"
}

func hookDisplayName(prefix string, n int) string {
	if n <= 1 {
		return prefix
	}
	return fmt.Sprintf("%s %d", prefix, n)
}

// buildToolEvent converts a hook payload into a ToolEvent based on hook type.
func (h *HookReceiver) buildToolEvent(hookType string, payload map[string]any, agentID string) *mapper.ToolEvent {
	switch hookType {
	case "PreToolUse":
		return &mapper.ToolEvent{
			Kind:     mapper.ToolStart,
			AgentID:  agentID,
			ToolName: stringFromMap(payload, "tool_name"),
			Input:    toInputMap(payload, "tool_input"),
		}

	case "PostToolUse":
		return &mapper.ToolEvent{
			Kind:     mapper.ToolEnd,
			AgentID:  agentID,
			ToolName: stringFromMap(payload, "tool_name"),
			Input:    toInputMap(payload, "tool_input"),
			Output:   stringFromMap(payload, "tool_response"),
			IsError:  false,
		}

	case "PostToolUseFailure":
		return &mapper.ToolEvent{
			Kind:     mapper.ToolError,
			AgentID:  agentID,
			ToolName: stringFromMap(payload, "tool_name"),
			Input:    toInputMap(payload, "tool_input"),
			Output:   stringFromMap(payload, "error"),
			IsError:  true,
		}

	case "SessionStart":
		return &mapper.ToolEvent{
			Kind:    mapper.SessionLife,
			AgentID: agentID,
			IsStart: true,
		}

	case "Stop", "SessionEnd":
		return &mapper.ToolEvent{
			Kind:    mapper.SessionLife,
			AgentID: agentID,
			IsStart: false,
		}

	case "SubagentStart":
		// Spawn a new subagent character
		subAgentID := stringFromMap(payload, "agent_id")
		if subAgentID == "" {
			subAgentID = fmt.Sprintf("%s-sub-%d", agentID, h.nextSubID(agentID))
		}
		subName := stringFromMap(payload, "agent_name")
		if subName == "" {
			subName = stringFromMap(payload, "description")
		}
		if subName == "" {
			subName = "subagent"
		}
		h.spawnSubagent(subAgentID, subName)
		return &mapper.ToolEvent{
			Kind:    mapper.SessionLife,
			AgentID: subAgentID,
			IsStart: true,
		}

	case "SubagentStop":
		subAgentID := stringFromMap(payload, "agent_id")
		if subAgentID == "" {
			return nil
		}
		return &mapper.ToolEvent{
			Kind:    mapper.SessionLife,
			AgentID: subAgentID,
			IsStart: false,
		}

	case "PreCompact":
		return &mapper.ToolEvent{
			Kind:     mapper.ToolStart,
			AgentID:  agentID,
			ToolName: "__compact__",
		}

	case "UserPromptSubmit", "Notification":
		// Low-value hooks — skipped to reduce UI churn during live sessions
		return nil

	case "PermissionRequest":
		return &mapper.ToolEvent{
			Kind:     mapper.ToolStart,
			AgentID:  agentID,
			ToolName: "__permission__",
			Input: map[string]any{
				"tool": stringFromMap(payload, "tool_name"),
			},
		}

	default:
		h.logger.Debug("unknown hook type", "type", hookType)
		return nil
	}
}

// nextSubID returns an incrementing subagent counter for a given parent agent.
func (h *HookReceiver) nextSubID(parentID string) int {
	h.nextSubSeq++
	return h.nextSubSeq
}

// spawnSubagent emits a spawn event for a new subagent character.
func (h *HookReceiver) spawnSubagent(subAgentID, name string) {
	h.mu.Lock()
	roles := []protocol.AgentRole{
		protocol.RoleRogue, protocol.RoleMage, protocol.RoleRanger,
		protocol.RoleCleric, protocol.RoleBard,
	}
	role := roles[h.nextSubSeq%len(roles)]
	h.agentInfo[subAgentID] = agentMeta{Name: name, Role: role}
	h.mu.Unlock()

	ev, err := protocol.NewEvent(protocol.AgentSpawn{
		Type:    protocol.TypeAgentSpawn,
		AgentID: subAgentID,
		Name:    name,
		Role:    role,
		Ts:      protocol.NowMs(),
	})
	if err == nil {
		h.eventSink(ev)
	}
}

func (h *HookReceiver) checkAuth(w http.ResponseWriter, r *http.Request) bool {
	if h.authToken == "" {
		return true
	}
	auth := r.Header.Get("Authorization")
	expected := "Bearer " + h.authToken
	if auth != expected {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

// stringFromMap extracts a string from a map, returning "" if missing.
func stringFromMap(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

// toInputMap extracts a sub-map from payload, handling both map and string forms.
func toInputMap(payload map[string]any, key string) map[string]any {
	v, ok := payload[key]
	if !ok {
		return nil
	}

	// Already a map
	if m, ok := v.(map[string]any); ok {
		return m
	}

	// String (JSON-encoded) — try to parse
	if s, ok := v.(string); ok {
		s = strings.TrimSpace(s)
		if len(s) > 0 && s[0] == '{' {
			var m map[string]any
			if err := json.Unmarshal([]byte(s), &m); err == nil {
				return m
			}
		}
	}

	return nil
}
