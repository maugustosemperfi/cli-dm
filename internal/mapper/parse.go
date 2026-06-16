package mapper

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ParseStreamLine parses a single JSONL line from Claude Code's stream-json
// output, Claude Code JSONL session files, or Cursor agent transcripts and
// returns ToolEvents for the mapper.
//
// It handles two main message types:
//   - "assistant": contains tool_use blocks (→ ToolStart) and thinking blocks
//   - "user": contains tool_result blocks (→ ToolEnd)
//
// Other types (permission-mode, file-history-snapshot, etc.) are silently skipped.
func ParseStreamLine(line []byte, agentID string) ([]ToolEvent, error) {
	var raw map[string]any
	if err := json.Unmarshal(line, &raw); err != nil {
		return nil, fmt.Errorf("invalid JSON line: %w", err)
	}

	// Check for per-entry agentId override (subagent entries)
	if aid, ok := raw["agentId"].(string); ok && aid != "" {
		agentID = aid
	}

	msgType, _ := raw["type"].(string)
	if msgType == "" {
		if role, _ := raw["role"].(string); role != "" {
			return parseCursorRoleMessage(raw, role, agentID)
		}
	}

	switch msgType {
	case "assistant":
		return parseAssistant(raw, agentID)
	case "user":
		return parseUser(raw, agentID)
	case "system":
		return parseSystem(raw, agentID)
	case "permission-mode", "file-history-snapshot", "attachment",
		"last-prompt", "custom-title", "agent-name",
		"queue-operation":
		// Known non-actionable types — skip silently
		return nil, nil
	case "":
		return nil, nil
	default:
		// Unknown type — log for training
		GetUnknownLogger().Log(UnknownEntry{
			Reason:  "unknown_type",
			Type:    msgType,
			AgentID: agentID,
			Sample:  truncate(string(line), 500),
		})
		return nil, nil
	}
}

func parseCursorRoleMessage(raw map[string]any, role string, agentID string) ([]ToolEvent, error) {
	switch role {
	case "assistant":
		return parseAssistant(raw, agentID)
	case "user":
		return parseCursorUser(raw, agentID)
	default:
		return nil, nil
	}
}

func parseCursorUser(raw map[string]any, agentID string) ([]ToolEvent, error) {
	message, _ := raw["message"].(map[string]any)
	if message == nil {
		return nil, nil
	}

	contentRaw, ok := message["content"]
	if !ok {
		return nil, nil
	}

	contentArr, ok := toSlice(contentRaw)
	if !ok {
		if s, isStr := contentRaw.(string); isStr && len(s) > 0 {
			return []ToolEvent{{
				Kind:     ToolStart,
				AgentID:  agentID,
				ToolName: "__user_input__",
				Input:    map[string]any{"text_length": len(s)},
			}}, nil
		}
		return nil, nil
	}

	var textLen int
	for _, item := range contentArr {
		block, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if blockType, _ := block["type"].(string); blockType == "text" {
			textLen += len(stringVal(block, "text"))
		}
	}
	if textLen == 0 {
		return nil, nil
	}
	return []ToolEvent{{
		Kind:     ToolStart,
		AgentID:  agentID,
		ToolName: "__user_input__",
		Input:    map[string]any{"text_length": textLen},
	}}, nil
}

func parseAssistant(raw map[string]any, agentID string) ([]ToolEvent, error) {
	message, _ := raw["message"].(map[string]any)
	if message == nil {
		return nil, nil
	}

	contentRaw, ok := message["content"]
	if !ok {
		return nil, nil
	}

	// content can be a string (plain text) or an array (content blocks)
	contentArr, ok := toSlice(contentRaw)
	if !ok {
		// String content from assistant — treat as thinking
		return nil, nil
	}

	var events []ToolEvent
	hasToolUse := false

	for _, item := range contentArr {
		block, ok := item.(map[string]any)
		if !ok {
			continue
		}

		blockType, _ := block["type"].(string)
		switch blockType {
		case "tool_use":
			hasToolUse = true
			te := ToolEvent{
				Kind:      ToolStart,
				AgentID:   agentID,
				ToolName:  stringVal(block, "name"),
				Input:     toMap(block["input"]),
				ToolUseID: stringVal(block, "id"),
			}
			events = append(events, te)

		case "thinking":
			te := ToolEvent{
				Kind:     ToolStart,
				AgentID:  agentID,
				ToolName: "__thinking__",
			}
			events = append(events, te)

		case "text":
			// Assistant is writing a response — this IS activity
			text, _ := block["text"].(string)
			if len(text) > 0 {
				te := ToolEvent{
					Kind:     ToolStart,
					AgentID:  agentID,
					ToolName: "__responding__",
					Input:    map[string]any{"text_length": len(text)},
				}
				events = append(events, te)
			}

		default:
			GetUnknownLogger().Log(UnknownEntry{
				Reason:  "unknown_block",
				Type:    blockType,
				AgentID: agentID,
				RawData: block,
			})
		}
	}

	// If stop_reason == "end_turn" and no tool_use, emit thinking end
	stopReason, _ := message["stop_reason"].(string)
	if stopReason == "" {
		stopReason, _ = raw["stop_reason"].(string)
	}
	if stopReason == "end_turn" && !hasToolUse {
		events = append(events, ToolEvent{
			Kind:     ToolEnd,
			AgentID:  agentID,
			ToolName: "__thinking__",
		})
	}

	return events, nil
}

func parseUser(raw map[string]any, agentID string) ([]ToolEvent, error) {
	message, _ := raw["message"].(map[string]any)
	if message == nil {
		return nil, nil
	}

	contentRaw, ok := message["content"]
	if !ok {
		return nil, nil
	}

	// content can be a string (user typed text) or an array (tool_result blocks)
	contentArr, ok := toSlice(contentRaw)
	if !ok {
		// Plain string user message — agent is receiving input
		if s, isStr := contentRaw.(string); isStr && len(s) > 0 {
			return []ToolEvent{{
				Kind:     ToolStart,
				AgentID:  agentID,
				ToolName: "__user_input__",
				Input:    map[string]any{"text_length": len(s)},
			}}, nil
		}
		return nil, nil
	}

	var events []ToolEvent

	for _, item := range contentArr {
		block, ok := item.(map[string]any)
		if !ok {
			continue
		}

		blockType, _ := block["type"].(string)
		switch blockType {
		case "tool_result":
			te := ToolEvent{
				Kind:      ToolEnd,
				AgentID:   agentID,
				ToolUseID: stringVal(block, "tool_use_id"),
				Output:    extractToolResultContent(block),
				IsError:   boolVal(block, "is_error"),
			}
			events = append(events, te)

		case "text":
			text, _ := block["text"].(string)
			if text == "" {
				continue
			}
			// User interrupted a tool call or response
			if strings.Contains(text, "[Request interrupted by user") {
				events = append(events, ToolEvent{
					Kind:     ToolEnd,
					AgentID:  agentID,
					ToolName: "__interrupted__",
				})
			} else if strings.HasPrefix(text, "Base directory for this skill:") {
				// Skill invocation (e.g. /finish, /commit)
				events = append(events, ToolEvent{
					Kind:     ToolStart,
					AgentID:  agentID,
					ToolName: "__user_input__",
					Input:    map[string]any{"text_length": len(text)},
				})
			} else if strings.Contains(text, "<task-notification>") {
				// Subagent task completion notification
				events = append(events, ToolEvent{
					Kind:     ToolStart,
					AgentID:  agentID,
					ToolName: "__user_input__",
					Input:    map[string]any{"text_length": len(text)},
				})
			}
		}
	}

	return events, nil
}

// extractToolResultContent extracts the text content from a tool_result block.
// The "content" field can be a string or an array of content blocks.
func extractToolResultContent(block map[string]any) string {
	c, ok := block["content"]
	if !ok {
		return ""
	}

	// Direct string
	if s, ok := c.(string); ok {
		return s
	}

	// Array of content blocks
	arr, ok := toSlice(c)
	if !ok {
		return ""
	}

	var result string
	for _, item := range arr {
		part, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if text, ok := part["text"].(string); ok {
			if result != "" {
				result += "\n"
			}
			result += text
		}
	}
	return result
}

// parseSystem handles "system" type JSONL entries — compaction, turn_duration, etc.
func parseSystem(raw map[string]any, agentID string) ([]ToolEvent, error) {
	subtype, _ := raw["subtype"].(string)
	switch subtype {
	case "compaction", "pre_compact", "compact_boundary":
		// Context window is being compacted — "brain overloaded!"
		return []ToolEvent{{
			Kind:     ToolStart,
			AgentID:  agentID,
			ToolName: "__compact__",
		}}, nil
	case "stop_hook_summary":
		// Turn ended — emit end event
		return []ToolEvent{{
			Kind:     ToolEnd,
			AgentID:  agentID,
			ToolName: "__thinking__",
		}}, nil
	case "api_error":
		// API unreachable (auth failures, TLS errors, rate limits) — agent is stuck
		msg := "API error"
		if errMsg, ok := raw["error"].(string); ok && errMsg != "" {
			msg = errMsg
		} else if errMsg, ok := raw["message"].(string); ok && errMsg != "" {
			msg = errMsg
		}
		return []ToolEvent{{
			Kind:     ToolStart,
			AgentID:  agentID,
			ToolName: "__api_error__",
			Input:    map[string]any{"message": msg},
		}}, nil
	default:
		// turn_duration, etc. — no events needed
		return nil, nil
	}
}

// ModelPricing holds per-million-token USD rates for a Claude model.
// Cache write uses the 5-min TTL multiplier (1.25× input), which is the
// common case; the JSONL does not distinguish 5-min vs 1-hour cache writes.
type ModelPricing struct {
	Input      float64
	Output     float64
	CacheRead  float64 // 0.1× input
	CacheWrite float64 // 1.25× input (5-min cache)
}

// modelPricing: per-million-token rates sourced from Anthropic's pricing docs.
// Keys are matched as prefixes against the JSONL `model` field, so
// dated variants like "claude-opus-4-7-20260201" resolve to "claude-opus-4-7".
var modelPricing = map[string]ModelPricing{
	// Opus 4.5 / 4.6 / 4.7 — current flagship rate card
	"claude-opus-4-7": {Input: 5.0, Output: 25.0, CacheRead: 0.50, CacheWrite: 6.25},
	"claude-opus-4-6": {Input: 5.0, Output: 25.0, CacheRead: 0.50, CacheWrite: 6.25},
	"claude-opus-4-5": {Input: 5.0, Output: 25.0, CacheRead: 0.50, CacheWrite: 6.25},
	// Opus 4 / 4.1 — legacy higher pricing
	"claude-opus-4-1": {Input: 15.0, Output: 75.0, CacheRead: 1.50, CacheWrite: 18.75},
	"claude-opus-4":   {Input: 15.0, Output: 75.0, CacheRead: 1.50, CacheWrite: 18.75},
	// Sonnet 4 / 4.5 / 4.6
	"claude-sonnet-4-6": {Input: 3.0, Output: 15.0, CacheRead: 0.30, CacheWrite: 3.75},
	"claude-sonnet-4-5": {Input: 3.0, Output: 15.0, CacheRead: 0.30, CacheWrite: 3.75},
	"claude-sonnet-4":   {Input: 3.0, Output: 15.0, CacheRead: 0.30, CacheWrite: 3.75},
	// Haiku 4.5
	"claude-haiku-4-5": {Input: 1.0, Output: 5.0, CacheRead: 0.10, CacheWrite: 1.25},
	"claude-haiku-3-5": {Input: 0.80, Output: 4.0, CacheRead: 0.08, CacheWrite: 1.0},
	// OpenAI models exposed through Cursor's API pool.
	"gpt-5.5":            {Input: 5.0, Output: 30.0, CacheRead: 0.50, CacheWrite: 0},
	"gpt-5.4-mini":       {Input: 0.75, Output: 4.5, CacheRead: 0.075, CacheWrite: 0},
	"gpt-5.4-nano":       {Input: 0.20, Output: 1.25, CacheRead: 0.020, CacheWrite: 0},
	"gpt-5.4":            {Input: 2.5, Output: 15.0, CacheRead: 0.25, CacheWrite: 0},
	"gpt-5.3-codex":      {Input: 1.75, Output: 14.0, CacheRead: 0.175, CacheWrite: 0},
	"gpt-5.2-codex":      {Input: 1.75, Output: 14.0, CacheRead: 0.175, CacheWrite: 0},
	"gpt-5.2":            {Input: 1.75, Output: 14.0, CacheRead: 0.175, CacheWrite: 0},
	"gpt-5.1-codex-mini": {Input: 0.25, Output: 2.0, CacheRead: 0.025, CacheWrite: 0},
	"gpt-5.1-codex":      {Input: 1.25, Output: 10.0, CacheRead: 0.125, CacheWrite: 0},
	"gpt-5-codex":        {Input: 1.25, Output: 10.0, CacheRead: 0.125, CacheWrite: 0},
	"gpt-5-mini":         {Input: 0.25, Output: 2.0, CacheRead: 0.025, CacheWrite: 0},
	"gpt-5":              {Input: 1.25, Output: 10.0, CacheRead: 0.125, CacheWrite: 0},
	// Cursor's Auto + Composer pool.
	"cursor-auto":    {Input: 1.25, Output: 6.0, CacheRead: 0.25, CacheWrite: 1.25},
	"cursor-default": {Input: 1.25, Output: 6.0, CacheRead: 0.25, CacheWrite: 1.25},
	"composer-2":     {Input: 0.50, Output: 2.50, CacheRead: 0.20, CacheWrite: 0},
	"composer-1.5":   {Input: 3.50, Output: 17.50, CacheRead: 0.35, CacheWrite: 0},
	"composer-1":     {Input: 1.25, Output: 10.0, CacheRead: 0.125, CacheWrite: 0},
}

// defaultPricing is used when the JSONL entry omits `model` or the ID is
// unrecognized. Opus 4.7 is the current flagship default.
var defaultPricing = modelPricing["claude-opus-4-7"]

// pricingForModel returns the rate card for a model ID. Matches longest
// prefix first so dated variants ("claude-opus-4-7-20260201") resolve to
// the right base model before any shorter prefix ("claude-opus-4") would.
func pricingForModel(model string) ModelPricing {
	if model == "" {
		return defaultPricing
	}
	if p, ok := modelPricing[model]; ok {
		return p
	}
	var bestKey string
	for k := range modelPricing {
		if strings.HasPrefix(model, k) && len(k) > len(bestKey) {
			bestKey = k
		}
	}
	if bestKey != "" {
		return modelPricing[bestKey]
	}
	return defaultPricing
}

// EstimateCostForModel estimates USD cost for token counts using the same
// model rate table as ExtractTokensFromMessage.
func EstimateCostForModel(model string, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens int64) float64 {
	p := pricingForModel(model)
	plainInput := float64(inputTokens - cacheReadTokens)
	if plainInput < 0 {
		plainInput = 0
	}
	return (plainInput * p.Input / 1_000_000) +
		(float64(outputTokens) * p.Output / 1_000_000) +
		(float64(cacheReadTokens) * p.CacheRead / 1_000_000) +
		(float64(cacheWriteTokens) * p.CacheWrite / 1_000_000)
}

// ExtractTokensFromMessage extracts usage data from an assistant message.
// Returns (inputTokens, outputTokens, estimatedCostUSD, ok).
//
// Claude Code JSONL does not include costUSD, so we estimate from token
// counts using the rate card for the message's `model` field (falling back
// to Opus 4.7 pricing when missing).
func ExtractTokensFromMessage(raw map[string]any) (int64, int64, float64, bool) {
	var usage map[string]any
	var modelID string
	if msg, _ := raw["message"].(map[string]any); msg != nil {
		usage, _ = msg["usage"].(map[string]any)
		modelID, _ = msg["model"].(string)
	}
	if usage == nil {
		usage, _ = raw["usage"].(map[string]any)
	}
	if modelID == "" {
		modelID, _ = raw["model"].(string)
	}
	if usage == nil {
		return 0, 0, 0, false
	}

	input, _ := usage["input_tokens"].(float64)
	output, _ := usage["output_tokens"].(float64)
	cacheRead, _ := usage["cache_read_input_tokens"].(float64)
	cacheWrite, _ := usage["cache_creation_input_tokens"].(float64)

	cost := EstimateCostForModel(modelID, int64(input), int64(output), int64(cacheRead), int64(cacheWrite))

	return int64(input), int64(output), cost, input > 0 || output > 0
}

// --- helpers ---

func stringVal(m map[string]any, key string) string {
	v, _ := m[key].(string)
	return v
}

func boolVal(m map[string]any, key string) bool {
	v, _ := m[key].(bool)
	return v
}

func toSlice(v any) ([]any, bool) {
	s, ok := v.([]any)
	return s, ok
}

func toMap(v any) map[string]any {
	m, _ := v.(map[string]any)
	return m
}
