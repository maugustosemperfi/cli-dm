package ingestion

import "testing"

func TestParseCursorComposerStats(t *testing.T) {
	raw := []byte(`{
		"contextTokensUsed": 164315,
		"promptTokenBreakdown": {"totalUsedTokens": 164315},
		"modelConfig": {"modelName": "gpt-5.5-extra-high"}
	}`)

	stats, ok := parseCursorComposerStats(raw)
	if !ok {
		t.Fatal("expected stats to parse")
	}
	if stats.ModelName != "gpt-5.5-extra-high" {
		t.Fatalf("unexpected model: %q", stats.ModelName)
	}
	if stats.InputTokens != 164315 {
		t.Fatalf("unexpected input tokens: %d", stats.InputTokens)
	}
}

func TestNormalizeCursorModelName(t *testing.T) {
	if got := normalizeCursorModelName(""); got != "cursor-default" {
		t.Fatalf("empty model = %q, want cursor-default", got)
	}
	if got := normalizeCursorModelName("Default"); got != "cursor-default" {
		t.Fatalf("Default model = %q, want cursor-default", got)
	}
	if got := normalizeCursorModelName("GPT-5.5-Extra-High"); got != "gpt-5.5-extra-high" {
		t.Fatalf("unexpected normalized model: %q", got)
	}
}

func TestEstimateCursorOutputTokens(t *testing.T) {
	raw := map[string]any{
		"role": "assistant",
		"message": map[string]any{
			"content": []any{
				map[string]any{"type": "text", "text": "12345678"},
				map[string]any{"type": "tool_use", "name": "ReadFile", "input": map[string]any{"path": "/tmp/a.go"}},
			},
		},
	}

	if got := estimateCursorOutputTokens(raw); got <= 2 {
		t.Fatalf("expected text plus tool payload tokens, got %d", got)
	}
}
