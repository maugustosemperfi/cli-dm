package ingestion

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

var safeCursorComposerID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

type cursorUsageReader struct {
	dbPath     string
	composerID string
	lastModel  string
}

type cursorComposerStats struct {
	ModelName     string
	InputTokens   int64
	ContextTokens int64
}

func newCursorUsageReader(transcriptPath string) *cursorUsageReader {
	composerID := strings.TrimSuffix(filepath.Base(transcriptPath), filepath.Ext(transcriptPath))
	if composerID == "" || !safeCursorComposerID.MatchString(composerID) {
		return nil
	}
	dbPath := cursorStateDBPath()
	if dbPath == "" {
		return nil
	}
	if _, err := os.Stat(dbPath); err != nil {
		return nil
	}
	return &cursorUsageReader{dbPath: dbPath, composerID: composerID}
}

func cursorStateDBPath() string {
	if override := os.Getenv("CLI_DM_CURSOR_STATE_DB"); override != "" {
		return override
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	switch runtime.GOOS {
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb")
	case "linux":
		return filepath.Join(home, ".config", "Cursor", "User", "globalStorage", "state.vscdb")
	case "windows":
		if appData := os.Getenv("APPDATA"); appData != "" {
			return filepath.Join(appData, "Cursor", "User", "globalStorage", "state.vscdb")
		}
	}
	return ""
}

func (r *cursorUsageReader) readStats() (cursorComposerStats, bool) {
	if r == nil {
		return cursorComposerStats{}, false
	}
	query := "SELECT value FROM cursorDiskKV WHERE key = 'composerData:" + r.composerID + "' LIMIT 1"
	out, err := exec.Command("sqlite3", "-readonly", "-batch", r.dbPath, query).Output()
	if err != nil {
		return cursorComposerStats{}, false
	}
	raw := strings.TrimSpace(string(out))
	if raw == "" {
		return cursorComposerStats{}, false
	}
	stats, ok := parseCursorComposerStats([]byte(raw))
	if ok && stats.ModelName != "" {
		r.lastModel = stats.ModelName
	}
	if ok && stats.ModelName == "" && r.lastModel != "" {
		stats.ModelName = r.lastModel
	}
	return stats, ok
}

func parseCursorComposerStats(raw []byte) (cursorComposerStats, bool) {
	var data struct {
		ContextTokensUsed    float64 `json:"contextTokensUsed"`
		PromptTokenBreakdown struct {
			TotalUsedTokens float64 `json:"totalUsedTokens"`
		} `json:"promptTokenBreakdown"`
		ModelConfig struct {
			ModelName string `json:"modelName"`
		} `json:"modelConfig"`
	}
	if err := json.Unmarshal(raw, &data); err != nil {
		return cursorComposerStats{}, false
	}
	input := int64(data.PromptTokenBreakdown.TotalUsedTokens)
	if input == 0 {
		input = int64(data.ContextTokensUsed)
	}
	return cursorComposerStats{
		ModelName:     normalizeCursorModelName(data.ModelConfig.ModelName),
		InputTokens:   input,
		ContextTokens: int64(data.ContextTokensUsed),
	}, input > 0 || data.ModelConfig.ModelName != ""
}

func normalizeCursorModelName(model string) string {
	model = strings.TrimSpace(strings.ToLower(model))
	if model == "" || model == "default" {
		return "cursor-default"
	}
	return model
}

func estimateTokensFromText(text string) int64 {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0
	}
	// A simple cross-provider approximation. Cursor's local composer metadata
	// gives prompt/context estimates; transcript output only gives text/tool
	// payloads, so use the common ~4 chars/token heuristic for completion size.
	tokens := int64((len([]rune(text)) + 3) / 4)
	if tokens < 1 {
		return 1
	}
	return tokens
}

func estimateCursorOutputTokens(raw map[string]any) int64 {
	message, _ := raw["message"].(map[string]any)
	if message == nil {
		return 0
	}
	content, _ := message["content"].([]any)
	if content == nil {
		if s, _ := message["content"].(string); s != "" {
			return estimateTokensFromText(s)
		}
		return 0
	}

	var total int64
	for _, item := range content {
		block, ok := item.(map[string]any)
		if !ok {
			continue
		}
		switch block["type"] {
		case "text":
			if text, _ := block["text"].(string); text != "" {
				total += estimateTokensFromText(text)
			}
		case "tool_use":
			encoded, err := json.Marshal(block)
			if err == nil {
				total += estimateTokensFromText(string(encoded))
			}
		}
	}
	return total
}
