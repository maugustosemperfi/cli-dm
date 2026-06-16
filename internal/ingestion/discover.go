package ingestion

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// DiscoveredSession represents a single JSONL session file with its metadata.
type DiscoveredSession struct {
	Path    string
	ModTime time.Time
}

// DiscoverActiveSession finds the most recently modified JSONL session file
// for the given project directory. Claude Code stores session files under
// ~/.claude/projects/<encoded-project-path>/, while Cursor stores transcripts
// under ~/.cursor/projects/<encoded-project-path>/agent-transcripts/.
func DiscoverActiveSession(projectDir string) (string, error) {
	sessions, err := DiscoverActiveSessions(projectDir, 0)
	if err != nil {
		return "", err
	}
	if len(sessions) == 0 {
		homeDir, _ := os.UserHomeDir()
		absProject, _ := filepath.Abs(projectDir)
		return "", fmt.Errorf("no JSONL session files found in %s or %s",
			filepath.Join(claudeProjectsRoot(homeDir), encodeProjectPath(absProject)),
			filepath.Join(cursorProjectsRoot(homeDir), encodeCursorProjectPath(absProject), "agent-transcripts"))
	}
	return sessions[0].Path, nil
}

// DiscoverActiveSessions finds ALL recently modified JSONL session files or
// Cursor transcript files for the given project directory. If maxAge is 0,
// all files are returned.
// Results are sorted by modification time (newest first).
func DiscoverActiveSessions(projectDir string, maxAge time.Duration) ([]DiscoveredSession, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("cannot determine home dir: %w", err)
	}
	absProject, err := filepath.Abs(projectDir)
	if err != nil {
		return nil, fmt.Errorf("resolving project dir: %w", err)
	}

	var sessions []DiscoveredSession
	claudeDir := filepath.Join(claudeProjectsRoot(homeDir), encodeProjectPath(absProject))
	claudeSessions, err := collectJSONLSessions(claudeDir, maxAge, false)
	if err != nil {
		return nil, err
	}
	sessions = append(sessions, claudeSessions...)

	cursorDir := filepath.Join(cursorProjectsRoot(homeDir), encodeCursorProjectPath(absProject), "agent-transcripts")
	cursorSessions, err := collectJSONLSessions(cursorDir, maxAge, true)
	if err != nil {
		return nil, err
	}
	sessions = append(sessions, cursorSessions...)

	// Sort newest first
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].ModTime.After(sessions[j].ModTime)
	})

	return sessions, nil
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

func claudeProjectsRoot(homeDir string) string {
	if override := os.Getenv("CLI_DM_CLAUDE_PROJECTS_DIR"); override != "" {
		return override
	}
	return filepath.Join(homeDir, ".claude", "projects")
}

func cursorProjectsRoot(homeDir string) string {
	if override := os.Getenv("CLI_DM_CURSOR_PROJECTS_DIR"); override != "" {
		return override
	}
	return filepath.Join(homeDir, ".cursor", "projects")
}

// encodeCursorProjectPath converts an absolute path to Cursor's project folder
// convention: trim the leading slash, then replace "/" and "." with "-".
// Example: "/Users/marcos.augusto/dev/nu" → "Users-marcos-augusto-dev-nu".
func encodeCursorProjectPath(dir string) string {
	s := filepath.Clean(dir)
	s = strings.TrimPrefix(s, string(filepath.Separator))
	s = strings.ReplaceAll(s, string(filepath.Separator), "-")
	s = strings.ReplaceAll(s, ".", "-")
	return s
}

// collectJSONLSessions returns JSONL files under root, optionally recursively.
// Missing roots are expected when only one of Claude Code/Cursor has been used.
func collectJSONLSessions(root string, maxAge time.Duration, recursive bool) ([]DiscoveredSession, error) {
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("cannot read session dir %s: %w", root, err)
	}

	cutoff := time.Time{}
	if maxAge > 0 {
		cutoff = time.Now().Add(-maxAge)
	}

	addIfSession := func(path string, info os.FileInfo, sessions *[]DiscoveredSession) {
		if info.IsDir() || !strings.HasSuffix(info.Name(), ".jsonl") {
			return
		}
		if maxAge > 0 && info.ModTime().Before(cutoff) {
			return
		}
		*sessions = append(*sessions, DiscoveredSession{Path: path, ModTime: info.ModTime()})
	}

	var sessions []DiscoveredSession
	if recursive {
		err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return nil
			}
			info, err := entry.Info()
			if err != nil {
				return nil
			}
			addIfSession(path, info, &sessions)
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("walking session dir %s: %w", root, err)
		}
		return sessions, nil
	}

	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("cannot read session dir %s: %w", root, err)
	}
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}
		addIfSession(filepath.Join(root, entry.Name()), info, &sessions)
	}
	return sessions, nil
}

// DiscoveredProject represents a project directory that has an active AI-agent
// JSONL session.
type DiscoveredProject struct {
	ProjectDir  string    // absolute path to the project directory
	ProjectName string    // basename (e.g. "mini-meta-repo")
	SessionPath string    // path to the most recent JSONL file
	ModTime     time.Time // last modified time of the JSONL file
}

// DiscoverProjectsInDir scans a parent directory for subdirectories that have
// active Claude Code sessions or Cursor agent transcripts.
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

	var results []DiscoveredProject

	claudeProjectsDir := claudeProjectsRoot(homeDir)
	if claudeProjects, err := discoverProjectsFromSessionRoots(
		claudeProjectsDir,
		encodeProjectPath(absParent),
		absParent,
		maxAge,
		false,
	); err != nil {
		return nil, err
	} else {
		results = append(results, claudeProjects...)
	}

	cursorProjectsDir := cursorProjectsRoot(homeDir)
	if cursorProjects, err := discoverProjectsFromSessionRoots(
		cursorProjectsDir,
		encodeCursorProjectPath(absParent),
		absParent,
		maxAge,
		true,
	); err != nil {
		return nil, err
	} else {
		results = append(results, cursorProjects...)
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].ModTime.After(results[j].ModTime)
	})
	return results, nil
}

func discoverProjectsFromSessionRoots(root, encodedPrefix, absParent string, maxAge time.Duration, cursor bool) ([]DiscoveredProject, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("cannot read %s: %w", root, err)
	}

	var results []DiscoveredProject
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dirName := entry.Name()
		if dirName != encodedPrefix && !strings.HasPrefix(dirName, encodedPrefix+"-") {
			continue
		}

		projectName, projectDir := projectFromEncodedDir(dirName, encodedPrefix, absParent)
		sessionDir := filepath.Join(root, dirName)
		recursive := false
		if cursor {
			sessionDir = filepath.Join(sessionDir, "agent-transcripts")
			recursive = true
		}

		sessions, err := collectJSONLSessions(sessionDir, maxAge, recursive)
		if err != nil {
			continue
		}
		if len(sessions) == 0 {
			continue
		}
		sort.Slice(sessions, func(i, j int) bool {
			return sessions[i].ModTime.After(sessions[j].ModTime)
		})

		results = append(results, DiscoveredProject{
			ProjectDir:  projectDir,
			ProjectName: projectName,
			SessionPath: sessions[0].Path,
			ModTime:     sessions[0].ModTime,
		})
	}
	return results, nil
}

func projectFromEncodedDir(dirName, encodedPrefix, absParent string) (string, string) {
	suffix := strings.TrimPrefix(dirName, encodedPrefix)
	suffix = strings.TrimPrefix(suffix, "-")
	if suffix == "" {
		return filepath.Base(absParent), absParent
	}
	return suffix, filepath.Join(absParent, suffix)
}
