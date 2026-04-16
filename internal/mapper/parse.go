package mapper

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ParseStreamLine parses a single JSONL line from Claude Code's stream-json
// output (or JSONL session file) and returns ToolEvents for the mapper.
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
				Reason:   "unknown_block",
				Type:     blockType,
				AgentID:  agentID,
				RawData:  block,
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

// ExtractTokensFromMessage extracts usage data from an assistant message.
// Returns (inputTokens, outputTokens, costUSD, ok).
func ExtractTokensFromMessage(raw map[string]any) (int64, int64, float64, bool) {
	// Check for usage field in the message or top-level
	var usage map[string]any
	if msg, _ := raw["message"].(map[string]any); msg != nil {
		usage, _ = msg["usage"].(map[string]any)
	}
	if usage == nil {
		usage, _ = raw["usage"].(map[string]any)
	}
	if usage == nil {
		return 0, 0, 0, false
	}

	input, _ := usage["input_tokens"].(float64)
	output, _ := usage["output_tokens"].(float64)

	// Check for cost field
	cost, _ := raw["costUSD"].(float64)
	if cost == 0 {
		if msg, _ := raw["message"].(map[string]any); msg != nil {
			cost, _ = msg["costUSD"].(float64)
		}
	}

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
