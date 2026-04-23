package mapper

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// UnknownLogger captures JSONL entries and tool names that the mapper
// doesn't understand, writing them to a file for later analysis/training.
//
// File location: ~/.cli-dm/unknown_events.jsonl
type UnknownLogger struct {
	mu   sync.Mutex
	file *os.File
	enc  *json.Encoder
	path string
	seen map[string]bool
}

// UnknownEntry is a single logged unknown event.
type UnknownEntry struct {
	Timestamp string         `json:"timestamp"`
	Reason    string         `json:"reason"`    // "unknown_type", "unknown_tool", "no_events", "unknown_block"
	Type      string         `json:"type,omitempty"`
	ToolName  string         `json:"tool_name,omitempty"`
	AgentID   string         `json:"agent_id,omitempty"`
	RawData   map[string]any `json:"raw,omitempty"`
	Sample    string         `json:"sample,omitempty"` // truncated raw text for quick scanning
}

var (
	globalLogger     *UnknownLogger
	globalLoggerOnce sync.Once
)

// GetUnknownLogger returns (or creates) the singleton unknown event logger.
func GetUnknownLogger() *UnknownLogger {
	globalLoggerOnce.Do(func() {
		home, err := os.UserHomeDir()
		if err != nil {
			home = "."
		}
		dir := filepath.Join(home, ".cli-dm")
		os.MkdirAll(dir, 0o755)
		path := filepath.Join(dir, "unknown_events.jsonl")

		f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			fmt.Fprintf(os.Stderr, "warning: cannot open unknown events log %s: %v\n", path, err)
			globalLogger = &UnknownLogger{path: path, seen: map[string]bool{}} // no-op logger
			return
		}

		globalLogger = &UnknownLogger{
			file: f,
			enc:  json.NewEncoder(f),
			path: path,
			seen: map[string]bool{},
		}
	})
	return globalLogger
}

// Log writes an unknown event entry to the log file. First-occurrence only
// per (reason, type, tool_name, block_type) signature — repeats are dropped.
func (ul *UnknownLogger) Log(entry UnknownEntry) {
	ul.mu.Lock()
	defer ul.mu.Unlock()

	blockType, _ := entry.RawData["type"].(string)
	sig := entry.Reason + "|" + entry.Type + "|" + entry.ToolName + "|" + blockType
	if ul.seen[sig] {
		return
	}
	ul.seen[sig] = true

	if ul.file == nil {
		return
	}
	entry.Timestamp = time.Now().Format(time.RFC3339)
	ul.enc.Encode(entry) //nolint: no need to check error on best-effort logging
}

// Path returns the log file path.
func (ul *UnknownLogger) Path() string {
	return ul.path
}

// Close flushes and closes the log file.
func (ul *UnknownLogger) Close() {
	ul.mu.Lock()
	defer ul.mu.Unlock()
	if ul.file != nil {
		ul.file.Close()
		ul.file = nil
	}
}
