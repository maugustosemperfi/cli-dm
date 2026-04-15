package ingestion

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// DiscoverActiveSession finds the most recently modified JSONL session file
// for the given project directory. Claude Code stores session files under
// ~/.claude/projects/<encoded-project-path>/.
func DiscoverActiveSession(projectDir string) (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot determine home dir: %w", err)
	}

	encoded := encodeProjectPath(projectDir)
	projectSessionDir := filepath.Join(homeDir, ".claude", "projects", encoded)

	entries, err := os.ReadDir(projectSessionDir)
	if err != nil {
		return "", fmt.Errorf("cannot read session dir %s: %w", projectSessionDir, err)
	}

	var bestPath string
	var bestTime int64

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if !strings.HasSuffix(entry.Name(), ".jsonl") {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		modTime := info.ModTime().UnixNano()
		if modTime > bestTime {
			bestTime = modTime
			bestPath = filepath.Join(projectSessionDir, entry.Name())
		}
	}

	if bestPath == "" {
		return "", fmt.Errorf("no JSONL session files found in %s", projectSessionDir)
	}

	return bestPath, nil
}

// encodeProjectPath converts an absolute path to the encoding Claude Code uses
// for its project session directory names. The convention replaces all "/" with
// "-", producing e.g. "/Users/marcos/dev/project" → "-Users-marcos-dev-project".
func encodeProjectPath(dir string) string {
	// Claude Code replaces both "/" and "." with "-" in project directory names
	s := strings.ReplaceAll(dir, "/", "-")
	s = strings.ReplaceAll(s, ".", "-")
	return s
}

// DiscoveredProject represents a project directory that has an active Claude session.
type DiscoveredProject struct {
	ProjectDir  string    // absolute path to the project directory
	ProjectName string    // basename (e.g. "mini-meta-repo")
	SessionPath string    // path to the most recent JSONL file
	ModTime     time.Time // last modified time of the JSONL file
}

// DiscoverProjectsInDir scans a parent directory for subdirectories that have
// active Claude Code sessions. It checks ~/.claude/projects/ for matching
// session directories and returns projects with recent JSONL files.
//
// maxAge controls how old a session can be to still count (0 = no limit).
func DiscoverProjectsInDir(parentDir string, maxAge time.Duration) ([]DiscoveredProject, error) {
	absParent, err := filepath.Abs(parentDir)
	if err != nil {
		return nil, fmt.Errorf("resolving parent dir: %w", err)
	}

	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("cannot determine home dir: %w", err)
	}
	claudeProjectsDir := filepath.Join(homeDir, ".claude", "projects")

	// Read all Claude project session directories
	claudeEntries, err := os.ReadDir(claudeProjectsDir)
	if err != nil {
		return nil, fmt.Errorf("cannot read %s: %w", claudeProjectsDir, err)
	}

	// Build a map of encoded-path → claude session dir
	encodedPrefix := encodeProjectPath(absParent)

	var results []DiscoveredProject
	cutoff := time.Now().Add(-maxAge)

	for _, ce := range claudeEntries {
		if !ce.IsDir() {
			continue
		}
		dirName := ce.Name()

		// Check if this session dir is for a project under our parent dir.
		// The encoding is lossy (both / and . become -), so we match by prefix.
		if !strings.HasPrefix(dirName, encodedPrefix) {
			continue
		}

		// Extract the project name: everything after the parent prefix.
		// e.g. prefix="-Users-marcos-augusto-dev-nu-" dirName="-Users-marcos-augusto-dev-nu-mini-meta-repo"
		// → suffix = "mini-meta-repo"
		suffix := strings.TrimPrefix(dirName, encodedPrefix)
		if suffix == "" {
			continue
		}
		projectName := suffix

		// Find the most recent JSONL in this session dir
		sessionDir := filepath.Join(claudeProjectsDir, dirName)
		entries, err := os.ReadDir(sessionDir)
		if err != nil {
			continue
		}

		var bestPath string
		var bestTime time.Time
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				continue
			}
			if info.ModTime().After(bestTime) {
				bestTime = info.ModTime()
				bestPath = filepath.Join(sessionDir, entry.Name())
			}
		}

		if bestPath == "" {
			continue
		}

		// Filter by age
		if maxAge > 0 && bestTime.Before(cutoff) {
			continue
		}

		results = append(results, DiscoveredProject{
			ProjectDir:  filepath.Join(absParent, projectName),
			ProjectName: projectName,
			SessionPath: bestPath,
			ModTime:     bestTime,
		})
	}

	return results, nil
}
