package ingestion

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"sync"
	"time"

	"github.com/marcosaugustodev/cli-dm/internal/mapper"
	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

// JSONLWatcher tails a JSONL file and emits protocol events via the Mapper.
// It polls the file every 200ms for new data, handling truncation (e.g., log rotation).
// Default roles for round-robin subagent assignment
var subagentRoles = []protocol.AgentRole{
	protocol.RoleRogue,
	protocol.RoleMage,
	protocol.RoleRanger,
	protocol.RoleCleric,
	protocol.RoleBard,
}

// inferredState tracks per-agent timing to detect when the model is generating
// a response but no JSONL line has been written yet (the "silent gap").
type inferredState struct {
	lastLineTime      time.Time
	expectingResponse bool // true after tool_result or user message
	generatingEmitted bool // true once we've emitted the synthetic event
}

type JSONLWatcher struct {
	mp        *mapper.Mapper
	eventSink EventSink
	logger    *slog.Logger
	filePath  string
	offset    int64
	done      chan struct{}
	once      sync.Once
	agentID   string

	// Subagent tracking: detect new agentIDs appearing in JSONL
	knownAgents map[string]bool
	subCount    int

	// Inferred activity: detect when model is generating but JSONL is silent
	inferStates map[string]*inferredState

	// Stale detection: 0=fresh, 1=idle emitted (5min), 2=complete emitted (30min)
	staleEmitted int
}

// NewJSONLWatcher creates a watcher for the given JSONL file path.
func NewJSONLWatcher(filePath, agentID string, mp *mapper.Mapper, sink EventSink, logger *slog.Logger) *JSONLWatcher {
	known := make(map[string]bool)
	known[agentID] = true
	return &JSONLWatcher{
		mp:          mp,
		eventSink:   sink,
		logger:      logger,
		filePath:    filePath,
		done:        make(chan struct{}),
		agentID:     agentID,
		knownAgents: known,
		inferStates: make(map[string]*inferredState),
	}
}

// BackfillBytes controls how many bytes from the end of the file to backfill
// when starting without full catch-up. Default: 64 KB (covers ~2-5 min of activity).
const BackfillBytes int64 = 64 * 1024

// Stale session thresholds — skip backfill or auto-complete based on file age.
const (
	StaleBackfillThreshold  = 10 * time.Minute  // skip backfill for files idle > 10min
	StaleCompleteThreshold  = 2 * time.Hour      // auto-complete for files idle > 2h
)

// Start begins watching the file. If catchUp is true, it reads from the
// beginning of the file; otherwise it backfills the last ~64KB (recent activity)
// to give an immediate snapshot of what's happening.
//
// Stale handling: if the file hasn't been modified in >10min, backfill is
// skipped (tail-only). If >2h, the agent is immediately marked complete.
func (w *JSONLWatcher) Start(catchUp bool) error {
	f, err := os.Open(w.filePath)
	if err != nil {
		return err
	}

	info, err := f.Stat()
	if err != nil {
		f.Close()
		return err
	}
	f.Close()

	staleDur := time.Since(info.ModTime())

	if !catchUp {
		if staleDur > StaleBackfillThreshold {
			// File is stale — tail only, don't replay old events
			w.offset = info.Size()
			w.logger.Info("skipping backfill for stale session", "path", w.filePath,
				"agent", w.agentID, "idle", staleDur.Truncate(time.Minute))
		} else {
			// Fresh session — backfill last 64KB for context
			backfillStart := info.Size() - BackfillBytes
			if backfillStart < 0 {
				backfillStart = 0
			}
			w.offset = backfillStart
		}
	}

	go w.watchLoop()

	// Auto-complete agents from very old sessions
	if staleDur > StaleCompleteThreshold {
		w.staleEmitted = 2
		ev, err := protocol.NewEvent(protocol.AgentComplete{
			Type:     protocol.TypeAgentComplete,
			AgentID:  w.agentID,
			ExitCode: 0,
			Ts:       protocol.NowMs(),
		})
		if err == nil {
			w.eventSink(ev)
		}
		w.emitRawOutput("\033[90m— session from previous run (no activity for " +
			staleDur.Truncate(time.Minute).String() + ") —\033[0m\r\n")
		w.logger.Info("auto-completed stale session", "path", w.filePath,
			"agent", w.agentID, "idle", staleDur.Truncate(time.Minute))
	}

	return nil
}

// Stop signals the watch loop to exit.
func (w *JSONLWatcher) Stop() {
	w.once.Do(func() {
		close(w.done)
	})
}

func (w *JSONLWatcher) watchLoop() {
	pollTicker := time.NewTicker(200 * time.Millisecond)
	sweepTicker := time.NewTicker(2 * time.Minute)
	defer pollTicker.Stop()
	defer sweepTicker.Stop()

	for {
		select {
		case <-w.done:
			return
		case <-pollTicker.C:
			w.poll()
		case <-sweepTicker.C:
			w.sweepStale()
		}
	}
}

// sweepStale checks if the JSONL file has been modified recently.
//   - 5 min idle → transition to idle (agent can wake up)
//   - 30 min idle → mark complete (agent leaves the dungeon)
func (w *JSONLWatcher) sweepStale() {
	info, err := os.Stat(w.filePath)
	if err != nil {
		return
	}
	staleDur := time.Since(info.ModTime())

	// 30 min: agent leaves the dungeon
	if staleDur > 30*time.Minute {
		if w.staleEmitted == 2 {
			return
		}
		ev, err := protocol.NewEvent(protocol.AgentComplete{
			Type:     protocol.TypeAgentComplete,
			AgentID:  w.agentID,
			ExitCode: 0,
			Ts:       protocol.NowMs(),
		})
		if err == nil {
			w.eventSink(ev)
		}
		w.staleEmitted = 2
		w.emitRawOutput("\033[90m— session ended (no activity for 30 min) —\033[0m\r\n")
		w.logger.Info("session ended", "path", w.filePath, "agent", w.agentID)
		return
	}

	// 5 min: transition to idle
	if staleDur > 5*time.Minute {
		if w.staleEmitted >= 1 {
			return
		}
		te := mapper.ToolEvent{
			Kind:     mapper.ToolEnd,
			AgentID:  w.agentID,
			ToolName: "__stale__",
		}
		events := w.mp.Map(te)
		for _, ev := range events {
			w.eventSink(ev)
		}
		w.staleEmitted = 1
		w.emitRawOutput("\033[90m— session idle (no activity for 5 min) —\033[0m\r\n")
		w.logger.Info("session idle", "path", w.filePath, "agent", w.agentID)
	}
}

func (w *JSONLWatcher) poll() {
	info, err := os.Stat(w.filePath)
	if err != nil {
		// File may not exist yet — that's OK, we'll retry
		return
	}

	size := info.Size()

	// Handle truncation (file was rotated or cleared)
	if size < w.offset {
		w.logger.Info("file truncated, resetting offset", "path", w.filePath)
		w.offset = 0
	}

	// No new data — but check if we should infer generating state
	if size == w.offset {
		w.inferActivity()
		return
	}

	f, err := os.Open(w.filePath)
	if err != nil {
		w.logger.Error("failed to open file", "path", w.filePath, "error", err)
		return
	}
	defer f.Close()

	if _, err := f.Seek(w.offset, io.SeekStart); err != nil {
		w.logger.Error("failed to seek", "path", w.filePath, "error", err)
		return
	}

	data, err := io.ReadAll(f)
	if err != nil {
		w.logger.Error("failed to read", "path", w.filePath, "error", err)
		return
	}

	w.offset += int64(len(data))

	// New data arrived — agent is alive, reset stale tier
	w.staleEmitted = 0

	// Split into lines and process each complete line
	lines := bytes.Split(data, []byte("\n"))
	for _, line := range lines {
		line = bytes.TrimSpace(line)
		if len(line) == 0 {
			continue
		}

		// Emit formatted terminal output for the JSONL entry
		termText := w.formatForTerminal(line)
		if termText != "" {
			w.emitRawOutput(termText)
		}

		toolEvents, err := mapper.ParseStreamLine(line, w.agentID)
		if err != nil {
			w.logger.Debug("skipping unparseable line", "error", err)
			continue
		}

		// Extract token/cost data from assistant messages → emit stats event
		var rawEntry map[string]any
		if json.Unmarshal(line, &rawEntry) == nil {
			if input, output, cost, ok := mapper.ExtractTokensFromMessage(rawEntry); ok {
				agentIDForStats := w.agentID
				if aid, ok2 := rawEntry["agentId"].(string); ok2 && aid != "" {
					agentIDForStats = aid
				}
				statsEv, _ := protocol.NewEvent(protocol.AgentStats{
					Type:    protocol.TypeAgentStats,
					AgentID: agentIDForStats,
					Tokens:  input + output,
					CostUSD: cost,
					Ts:      protocol.NowMs(),
				})
				w.eventSink(statsEv)
			}
		}

		// Log entries that produced no events AND no terminal output
		if len(toolEvents) == 0 && termText == "" {
			var raw map[string]any
			if json.Unmarshal(line, &raw) == nil {
				msgType, _ := raw["type"].(string)
				// Only log non-trivially-skipped types
				if msgType != "" && msgType != "permission-mode" && msgType != "file-history-snapshot" &&
					msgType != "last-prompt" && msgType != "custom-title" && msgType != "agent-name" && msgType != "attachment" {
					mapper.GetUnknownLogger().Log(mapper.UnknownEntry{
						Reason:  "no_events",
						Type:    msgType,
						AgentID: w.agentID,
						Sample:  truncateStr(string(line), 500),
					})
				}
			}
		}

		for _, te := range toolEvents {
			// Detect new subagent IDs — auto-spawn a character for them
			if te.AgentID != "" && !w.knownAgents[te.AgentID] {
				w.knownAgents[te.AgentID] = true
				w.subCount++
				role := subagentRoles[w.subCount%len(subagentRoles)]

				// Extract subagent description from the JSONL entry if available
				subName := fmt.Sprintf("subagent-%d", w.subCount)
				var raw map[string]any
				if json.Unmarshal(line, &raw) == nil {
					if an, ok := raw["agentName"].(string); ok && an != "" {
						subName = an
					} else if slug, ok := raw["slug"].(string); ok && slug != "" {
						subName = slug
					}
				}

				spawnEv, _ := protocol.NewEvent(protocol.AgentSpawn{
					Type:    protocol.TypeAgentSpawn,
					AgentID: te.AgentID,
					Name:    subName,
					Role:    role,
					Ts:      protocol.NowMs(),
				})
				w.eventSink(spawnEv)
				w.logger.Info("subagent detected", "parent", w.agentID, "subagent", te.AgentID, "name", subName)

				// Also emit terminal output
				w.emitRawOutputFor(te.AgentID, fmt.Sprintf("\033[35m⚔ Subagent spawned: %s\033[0m\r\n", subName))
			}

			// Route terminal output to the correct agent
			if te.AgentID != w.agentID && termText != "" {
				w.emitRawOutputFor(te.AgentID, termText)
			}

			// Track inference state for this agent
			aid := te.AgentID
			if aid == "" {
				aid = w.agentID
			}
			is := w.getInferState(aid)
			switch {
			case te.Kind == mapper.ToolEnd && te.ToolName == "__thinking__":
				// End of turn — conversation paused, waiting for user
				is.expectingResponse = false
				is.generatingEmitted = false
			case te.Kind == mapper.ToolEnd:
				// Tool result finished — model will generate next response
				is.lastLineTime = time.Now()
				is.expectingResponse = true
				is.generatingEmitted = false
			case te.Kind == mapper.ToolStart && te.ToolName == "__user_input__":
				// User sent a message — model will generate a response
				is.lastLineTime = time.Now()
				is.expectingResponse = true
				is.generatingEmitted = false
			case te.Kind == mapper.ToolStart:
				// Model is actively doing something
				is.expectingResponse = false
				is.generatingEmitted = false
			}

			events := w.mp.Map(te)
			for _, ev := range events {
				w.eventSink(ev)
			}
		}
	}

	// Check inferred activity after processing all new lines
	w.inferActivity()
}

// getInferState returns (or creates) the inference state for an agent.
func (w *JSONLWatcher) getInferState(agentID string) *inferredState {
	s, ok := w.inferStates[agentID]
	if !ok {
		s = &inferredState{}
		w.inferStates[agentID] = s
	}
	return s
}

// inferActivity emits synthetic "generating" events for agents where the JSONL
// has gone silent after a tool result or user message — meaning the model is
// generating but hasn't written a response yet.
func (w *JSONLWatcher) inferActivity() {
	now := time.Now()
	const threshold = time.Second // 1s of silence = infer generating

	for agentID, is := range w.inferStates {
		if !is.expectingResponse || is.generatingEmitted {
			continue
		}
		if now.Sub(is.lastLineTime) < threshold {
			continue
		}

		// Emit synthetic generating event
		te := mapper.ToolEvent{
			Kind:     mapper.ToolStart,
			AgentID:  agentID,
			ToolName: "__generating__",
		}
		events := w.mp.Map(te)
		for _, ev := range events {
			w.eventSink(ev)
		}
		w.emitRawOutputFor(agentID, "\033[33m✦ generating response...\033[0m\r\n")
		is.generatingEmitted = true
	}
}

// emitRawOutput sends a raw.stdout event for the main agent.
func (w *JSONLWatcher) emitRawOutput(text string) {
	w.emitRawOutputFor(w.agentID, text)
}

// emitRawOutputFor sends a raw.stdout event for a specific agent ID.
func (w *JSONLWatcher) emitRawOutputFor(agentID string, text string) {
	encoded := base64.StdEncoding.EncodeToString([]byte(text))
	ev, _ := protocol.NewEvent(protocol.RawStdout{
		Type:    protocol.TypeRawStdout,
		AgentID: agentID,
		Data:    encoded,
		Ts:      protocol.NowMs(),
	})
	w.eventSink(ev)
}

// formatForTerminal converts a JSONL entry into human-readable terminal text.
// Returns empty string for entries that shouldn't be shown.
func (w *JSONLWatcher) formatForTerminal(line []byte) string {
	var entry map[string]any
	if err := json.Unmarshal(line, &entry); err != nil {
		return ""
	}

	msgType, _ := entry["type"].(string)
	ts, _ := entry["timestamp"].(string)
	timeStr := ""
	if t, err := time.Parse(time.RFC3339Nano, ts); err == nil {
		timeStr = t.Local().Format("15:04:05")
	}

	switch msgType {
	case "system":
		subtype, _ := entry["subtype"].(string)
		switch subtype {
		case "turn_duration":
			durationMs, _ := entry["durationMs"].(float64)
			msgCount, _ := entry["messageCount"].(float64)
			if durationMs > 0 {
				secs := durationMs / 1000
				return fmt.Sprintf("\033[90m[%s]\033[0m \033[33m⏱ Turn finished: %.1fs, %d messages\033[0m\r\n", timeStr, secs, int(msgCount))
			}
		case "stop_hook_summary":
			return fmt.Sprintf("\033[90m[%s]\033[0m \033[90m— turn ended —\033[0m\r\n", timeStr)
		}
		return ""

	case "queue-operation":
		op, _ := entry["operation"].(string)
		if op == "enqueue" {
			return fmt.Sprintf("\033[90m[%s]\033[0m \033[35m📨 Message queued\033[0m\r\n", timeStr)
		}
		return ""

	case "assistant":
		msg, _ := entry["message"].(map[string]any)
		if msg == nil {
			return ""
		}
		content, _ := msg["content"].([]any)
		if content == nil {
			return ""
		}

		var parts []string
		for _, item := range content {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			blockType, _ := block["type"].(string)

			switch blockType {
			case "tool_use":
				name, _ := block["name"].(string)
				input, _ := block["input"].(map[string]any)
				detail := formatToolDetail(name, input)
				parts = append(parts, fmt.Sprintf("\033[36m⏺ %s\033[0m %s", name, detail))

			case "text":
				text, _ := block["text"].(string)
				if len(text) > 200 {
					text = text[:200] + "..."
				}
				if text != "" {
					parts = append(parts, fmt.Sprintf("\033[37m%s\033[0m", text))
				}

			case "thinking":
				parts = append(parts, "\033[33m✦ thinking...\033[0m")
			}
		}

		if len(parts) == 0 {
			return ""
		}
		result := ""
		for _, p := range parts {
			result += fmt.Sprintf("\033[90m[%s]\033[0m %s\r\n", timeStr, p)
		}
		return result

	case "user":
		msg, _ := entry["message"].(map[string]any)
		if msg == nil {
			return ""
		}
		content, _ := msg["content"].([]any)
		if content == nil {
			// User text message
			text, _ := msg["content"].(string)
			if text != "" && len(text) < 300 {
				return fmt.Sprintf("\033[90m[%s]\033[0m \033[32m❯ %s\033[0m\r\n", timeStr, text)
			}
			return ""
		}

		var parts []string
		for _, item := range content {
			block, ok := item.(map[string]any)
			if !ok {
				continue
			}
			blockType, _ := block["type"].(string)

			if blockType == "tool_result" {
				resultText, _ := block["content"].(string)
				isError, _ := block["is_error"].(bool)
				if resultText != "" {
					// Truncate long results
					if len(resultText) > 400 {
						resultText = resultText[:400] + "..."
					}
					color := "90" // gray
					prefix := "  ↳"
					if isError {
						color = "31" // red
						prefix = "  ✗"
					}
					parts = append(parts, fmt.Sprintf("\033[%sm%s %s\033[0m", color, prefix, resultText))
				}
			}
		}

		if len(parts) == 0 {
			return ""
		}
		result := ""
		for _, p := range parts {
			result += fmt.Sprintf("%s\r\n", p)
		}
		return result

	default:
		return ""
	}
}

// formatToolDetail creates a short description from tool name + input.
func formatToolDetail(name string, input map[string]any) string {
	switch name {
	case "Read":
		if fp, ok := input["file_path"].(string); ok {
			return fp
		}
	case "Edit":
		if fp, ok := input["file_path"].(string); ok {
			return fp
		}
	case "Write":
		if fp, ok := input["file_path"].(string); ok {
			return fp
		}
	case "Bash":
		if cmd, ok := input["command"].(string); ok {
			if len(cmd) > 120 {
				cmd = cmd[:120] + "..."
			}
			return cmd
		}
	case "Grep":
		if p, ok := input["pattern"].(string); ok {
			return fmt.Sprintf("/%s/", p)
		}
	case "Glob":
		if p, ok := input["pattern"].(string); ok {
			return p
		}
	case "Agent":
		if d, ok := input["description"].(string); ok {
			return d
		}
	case "WebSearch":
		if q, ok := input["query"].(string); ok {
			return q
		}
	case "WebFetch":
		if u, ok := input["url"].(string); ok {
			return u
		}
	case "TaskCreate":
		if s, ok := input["subject"].(string); ok {
			return s
		}
	case "TaskUpdate":
		if id, ok := input["taskId"].(string); ok {
			status, _ := input["status"].(string)
			return fmt.Sprintf("#%s → %s", id, status)
		}
	}
	return ""
}

func truncateStr(s string, max int) string {
	if len(s) > max {
		return s[:max] + "..."
	}
	return s
}
