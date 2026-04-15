package storage

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

// EventStore persists protocol events for a session.
type EventStore interface {
	Write(ev protocol.Event) error
	ReadAll(sessionID string) ([]protocol.Event, error)
	Close() error
}

// SessionMeta holds metadata about a recorded session.
type SessionMeta struct {
	ID         string    `json:"id"`
	StartedAt  time.Time `json:"startedAt"`
	EndedAt    time.Time `json:"endedAt,omitempty"`
	ConfigFile string    `json:"configFile,omitempty"`
	Status     string    `json:"status"` // "running", "completed", "failed"
	AgentCount int       `json:"agentCount"`
	TaskCount  int       `json:"taskCount"`
	EventCount int       `json:"eventCount"`
	AgentNames []string  `json:"agentNames,omitempty"`
	TaskLabels []string  `json:"taskLabels,omitempty"`
}

// FileEventStore writes events as newline-delimited JSON to a session directory.
type FileEventStore struct {
	sessionID string
	baseDir   string
	meta      SessionMeta
	file      *os.File
	writer    *bufio.Writer
	mu        sync.Mutex
	count     int
	ticker    *time.Ticker
	done      chan struct{}
}

// NewFileEventStore creates a new event store for the given session.
// It creates the session directory, initialises the events.jsonl file
// and writes the initial meta.json.
func NewFileEventStore(sessionID, baseDir string, meta SessionMeta) (*FileEventStore, error) {
	dir := filepath.Join(baseDir, sessionID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("creating session dir: %w", err)
	}

	f, err := os.Create(filepath.Join(dir, "events.jsonl"))
	if err != nil {
		return nil, fmt.Errorf("creating events file: %w", err)
	}

	meta.ID = sessionID
	meta.Status = "running"
	if meta.StartedAt.IsZero() {
		meta.StartedAt = time.Now()
	}

	s := &FileEventStore{
		sessionID: sessionID,
		baseDir:   baseDir,
		meta:      meta,
		file:      f,
		writer:    bufio.NewWriter(f),
		done:      make(chan struct{}),
	}

	if err := s.writeMeta(); err != nil {
		f.Close()
		return nil, fmt.Errorf("writing initial meta: %w", err)
	}

	// Periodic flush every 5 seconds.
	s.ticker = time.NewTicker(5 * time.Second)
	go s.flushLoop()

	return s, nil
}

// Write appends an event to the NDJSON file. It is safe for concurrent use.
func (s *FileEventStore) Write(ev protocol.Event) error {
	data, err := json.Marshal(ev)
	if err != nil {
		return fmt.Errorf("marshaling event: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, err := s.writer.Write(data); err != nil {
		return fmt.Errorf("writing event: %w", err)
	}
	if err := s.writer.WriteByte('\n'); err != nil {
		return fmt.Errorf("writing newline: %w", err)
	}

	s.count++

	// Flush every 100 events.
	if s.count%100 == 0 {
		if err := s.writer.Flush(); err != nil {
			return fmt.Errorf("flushing writer: %w", err)
		}
	}

	return nil
}

// ReadAll reads every event from a session's events.jsonl file.
func (s *FileEventStore) ReadAll(sessionID string) ([]protocol.Event, error) {
	path := filepath.Join(s.baseDir, sessionID, "events.jsonl")
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("opening events file: %w", err)
	}
	defer f.Close()

	var events []protocol.Event
	scanner := bufio.NewScanner(f)
	// Allow lines up to 1 MB.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var ev protocol.Event
		if err := json.Unmarshal(line, &ev); err != nil {
			return nil, fmt.Errorf("unmarshaling event: %w", err)
		}
		events = append(events, ev)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scanning events file: %w", err)
	}

	return events, nil
}

// Close flushes remaining data, updates meta.json with final counts and
// status="completed", and releases all resources.
func (s *FileEventStore) Close() error {
	s.ticker.Stop()
	close(s.done)

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := s.writer.Flush(); err != nil {
		return fmt.Errorf("final flush: %w", err)
	}
	if err := s.file.Close(); err != nil {
		return fmt.Errorf("closing events file: %w", err)
	}

	s.meta.EventCount = s.count
	s.meta.EndedAt = time.Now()
	if s.meta.Status == "running" {
		s.meta.Status = "completed"
	}

	return s.writeMeta()
}

// SetStatus allows callers to mark a session as failed before Close.
func (s *FileEventStore) SetStatus(status string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.meta.Status = status
}

// flushLoop periodically flushes the buffered writer.
func (s *FileEventStore) flushLoop() {
	for {
		select {
		case <-s.ticker.C:
			s.mu.Lock()
			_ = s.writer.Flush()
			s.mu.Unlock()
		case <-s.done:
			return
		}
	}
}

// writeMeta writes the current SessionMeta to meta.json. Must be called
// with the lock held or before concurrent access begins.
func (s *FileEventStore) writeMeta() error {
	path := filepath.Join(s.baseDir, s.sessionID, "meta.json")
	data, err := json.MarshalIndent(s.meta, "", "  ")
	if err != nil {
		return fmt.Errorf("marshaling meta: %w", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("writing meta file: %w", err)
	}
	return nil
}
