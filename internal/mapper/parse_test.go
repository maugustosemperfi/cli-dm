package mapper

import (
	"testing"

	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

func TestParseCursorAssistantToolUse(t *testing.T) {
	line := []byte(`{"role":"assistant","message":{"content":[{"type":"text","text":"I will read the file."},{"type":"tool_use","name":"ReadFile","input":{"path":"/tmp/app.go"}}]}}`)

	events, err := ParseStreamLine(line, "cursor-1")
	if err != nil {
		t.Fatalf("ParseStreamLine returned error: %v", err)
	}
	if len(events) != 2 {
		t.Fatalf("expected 2 events, got %d: %#v", len(events), events)
	}
	if events[0].ToolName != "__responding__" {
		t.Fatalf("expected first event to be responding, got %q", events[0].ToolName)
	}
	if events[1].ToolName != "ReadFile" {
		t.Fatalf("expected ReadFile tool event, got %q", events[1].ToolName)
	}
	if got := events[1].Input["path"]; got != "/tmp/app.go" {
		t.Fatalf("expected path input to be preserved, got %#v", got)
	}
}

func TestParseCursorUserText(t *testing.T) {
	line := []byte(`{"role":"user","message":{"content":[{"type":"text","text":"Make it work in Cursor too"}]}}`)

	events, err := ParseStreamLine(line, "cursor-1")
	if err != nil {
		t.Fatalf("ParseStreamLine returned error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event, got %d: %#v", len(events), events)
	}
	if events[0].ToolName != "__user_input__" {
		t.Fatalf("expected user input event, got %q", events[0].ToolName)
	}
}

func TestCursorToolNamesMapToActions(t *testing.T) {
	tests := []struct {
		name       string
		toolName   string
		input      map[string]any
		wantAction protocol.ActionType
		wantDetail string
	}{
		{
			name:       "read file path",
			toolName:   "ReadFile",
			input:      map[string]any{"path": "/tmp/app.go"},
			wantAction: protocol.ActionRead,
			wantDetail: "/tmp/app.go",
		},
		{
			name:       "shell git command",
			toolName:   "Shell",
			input:      map[string]any{"command": "git status --short"},
			wantAction: protocol.ActionGit,
			wantDetail: "git status",
		},
		{
			name:       "ripgrep search",
			toolName:   "rg",
			input:      map[string]any{"pattern": "Cursor"},
			wantAction: protocol.ActionRead,
			wantDetail: "Cursor",
		},
		{
			name:       "patch edit",
			toolName:   "ApplyPatch",
			input:      map[string]any{},
			wantAction: protocol.ActionEdit,
			wantDetail: "",
		},
		{
			name:       "mcp call",
			toolName:   "CallMcpTool",
			input:      map[string]any{"server": "user-slack", "toolName": "slack_read_thread"},
			wantAction: protocol.ActionNetwork,
			wantDetail: "user-slack",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			action, detail := mapToolName(tt.toolName, tt.input)
			if action != tt.wantAction || detail != tt.wantDetail {
				t.Fatalf("mapToolName(%q) = (%q, %q), want (%q, %q)",
					tt.toolName, action, detail, tt.wantAction, tt.wantDetail)
			}
		})
	}
}

func TestEstimateCostForOpenAIModel(t *testing.T) {
	cost := EstimateCostForModel("gpt-5.5-extra-high", 1_000_000, 1_000_000, 0, 0)
	if cost != 35.0 {
		t.Fatalf("unexpected gpt-5.5 cost: %f", cost)
	}
}
