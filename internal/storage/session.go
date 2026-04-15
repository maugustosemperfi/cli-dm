package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// SessionManager provides operations on persisted sessions.
type SessionManager struct {
	baseDir string // e.g. ~/.cli-dm/sessions
}

// NewSessionManager creates a new session manager rooted at baseDir.
func NewSessionManager(baseDir string) *SessionManager {
	return &SessionManager{baseDir: baseDir}
}

// ListSessions scans all session directories and returns their metadata
// sorted by startedAt descending (newest first).
func (sm *SessionManager) ListSessions() ([]SessionMeta, error) {
	entries, err := os.ReadDir(sm.baseDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("reading sessions dir: %w", err)
	}

	var sessions []SessionMeta
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		meta, err := sm.readMeta(e.Name())
		if err != nil {
			continue // skip corrupt sessions
		}
		sessions = append(sessions, *meta)
	}

	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedAt.After(sessions[j].StartedAt)
	})

	return sessions, nil
}

// SearchSessions performs a case-insensitive search across session ID,
// config file path, agent names, and task labels.
func (sm *SessionManager) SearchSessions(query string) ([]SessionMeta, error) {
	all, err := sm.ListSessions()
	if err != nil {
		return nil, err
	}

	q := strings.ToLower(query)
	var matched []SessionMeta

	for _, m := range all {
		if sm.metaMatches(m, q) {
			matched = append(matched, m)
		}
	}

	return matched, nil
}

// GetSession reads the metadata for a single session by ID.
func (sm *SessionManager) GetSession(id string) (*SessionMeta, error) {
	return sm.readMeta(id)
}

// DeleteSession removes an entire session directory.
func (sm *SessionManager) DeleteSession(id string) error {
	dir := filepath.Join(sm.baseDir, id)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return fmt.Errorf("session %q not found", id)
	}
	return os.RemoveAll(dir)
}

// CleanOldSessions deletes sessions whose startedAt is older than
// retentionDays ago.
func (sm *SessionManager) CleanOldSessions(retentionDays int) error {
	sessions, err := sm.ListSessions()
	if err != nil {
		return err
	}

	cutoff := time.Now().AddDate(0, 0, -retentionDays)
	for _, s := range sessions {
		if s.StartedAt.Before(cutoff) {
			if err := sm.DeleteSession(s.ID); err != nil {
				return fmt.Errorf("deleting session %s: %w", s.ID, err)
			}
		}
	}

	return nil
}

// readMeta reads and parses the meta.json for a given session ID.
func (sm *SessionManager) readMeta(id string) (*SessionMeta, error) {
	path := filepath.Join(sm.baseDir, id, "meta.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading meta for %s: %w", id, err)
	}

	var meta SessionMeta
	if err := json.Unmarshal(data, &meta); err != nil {
		return nil, fmt.Errorf("parsing meta for %s: %w", id, err)
	}

	return &meta, nil
}

// metaMatches checks if a session's metadata matches the query string
// (case-insensitive) against ID, config file, agent names, and task labels.
func (sm *SessionManager) metaMatches(m SessionMeta, query string) bool {
	if strings.Contains(strings.ToLower(m.ID), query) {
		return true
	}
	if strings.Contains(strings.ToLower(m.ConfigFile), query) {
		return true
	}
	if strings.Contains(strings.ToLower(m.Status), query) {
		return true
	}
	for _, name := range m.AgentNames {
		if strings.Contains(strings.ToLower(name), query) {
			return true
		}
	}
	for _, label := range m.TaskLabels {
		if strings.Contains(strings.ToLower(label), query) {
			return true
		}
	}
	return false
}
