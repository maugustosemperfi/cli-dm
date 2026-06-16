package ingestion

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDiscoverActiveSessionsIncludesCursorTranscripts(t *testing.T) {
	home := testHome(t)
	t.Setenv("HOME", home)
	claudeRoot := filepath.Join(home, "claude-projects")
	cursorRoot := filepath.Join(home, "cursor-projects")
	t.Setenv("CLI_DM_CLAUDE_PROJECTS_DIR", claudeRoot)
	t.Setenv("CLI_DM_CURSOR_PROJECTS_DIR", cursorRoot)

	projectDir := filepath.Join(home, "dev", "nu", "cli-dm")
	if err := os.MkdirAll(projectDir, 0o755); err != nil {
		t.Fatalf("creating project dir: %v", err)
	}

	claudeDir := filepath.Join(claudeRoot, encodeProjectPath(projectDir))
	cursorDir := filepath.Join(cursorRoot, encodeCursorProjectPath(projectDir), "agent-transcripts", "session-1", "subagents")
	if err := os.MkdirAll(claudeDir, 0o755); err != nil {
		t.Fatalf("creating claude dir: %v", err)
	}
	if err := os.MkdirAll(cursorDir, 0o755); err != nil {
		t.Fatalf("creating cursor dir: %v", err)
	}

	claudePath := filepath.Join(claudeDir, "claude.jsonl")
	cursorPath := filepath.Join(cursorDir, "cursor-subagent.jsonl")
	writeSessionFile(t, claudePath, time.Now().Add(-2*time.Minute))
	writeSessionFile(t, cursorPath, time.Now().Add(-1*time.Minute))

	sessions, err := DiscoverActiveSessions(projectDir, time.Hour)
	if err != nil {
		t.Fatalf("DiscoverActiveSessions returned error: %v", err)
	}
	if len(sessions) != 2 {
		t.Fatalf("expected 2 sessions, got %d: %#v", len(sessions), sessions)
	}
	if sessions[0].Path != cursorPath {
		t.Fatalf("expected newest Cursor transcript first, got %s", sessions[0].Path)
	}
	if sessions[1].Path != claudePath {
		t.Fatalf("expected Claude transcript second, got %s", sessions[1].Path)
	}
}

func TestDiscoverProjectsInDirIncludesCursorParentWorkspace(t *testing.T) {
	home := testHome(t)
	t.Setenv("HOME", home)
	claudeRoot := filepath.Join(home, "claude-projects")
	cursorRoot := filepath.Join(home, "cursor-projects")
	t.Setenv("CLI_DM_CLAUDE_PROJECTS_DIR", claudeRoot)
	t.Setenv("CLI_DM_CURSOR_PROJECTS_DIR", cursorRoot)

	parentDir := filepath.Join(home, "dev", "nu")
	if err := os.MkdirAll(parentDir, 0o755); err != nil {
		t.Fatalf("creating parent dir: %v", err)
	}

	cursorDir := filepath.Join(cursorRoot, encodeCursorProjectPath(parentDir), "agent-transcripts", "session-1")
	if err := os.MkdirAll(cursorDir, 0o755); err != nil {
		t.Fatalf("creating cursor dir: %v", err)
	}
	cursorPath := filepath.Join(cursorDir, "session-1.jsonl")
	writeSessionFile(t, cursorPath, time.Now())

	projects, err := DiscoverProjectsInDir(parentDir, time.Hour)
	if err != nil {
		t.Fatalf("DiscoverProjectsInDir returned error: %v", err)
	}
	if len(projects) != 1 {
		t.Fatalf("expected 1 project, got %d: %#v", len(projects), projects)
	}
	if projects[0].ProjectName != "nu" {
		t.Fatalf("expected parent workspace to be named nu, got %q", projects[0].ProjectName)
	}
	if projects[0].ProjectDir != parentDir {
		t.Fatalf("expected project dir %s, got %s", parentDir, projects[0].ProjectDir)
	}
	if projects[0].SessionPath != cursorPath {
		t.Fatalf("expected session path %s, got %s", cursorPath, projects[0].SessionPath)
	}
}

func writeSessionFile(t *testing.T, path string, modTime time.Time) {
	t.Helper()
	if err := os.WriteFile(path, []byte(`{"role":"user","message":{"content":[{"type":"text","text":"hello"}]}}`+"\n"), 0o644); err != nil {
		t.Fatalf("writing session file %s: %v", path, err)
	}
	if err := os.Chtimes(path, modTime, modTime); err != nil {
		t.Fatalf("setting session file time %s: %v", path, err)
	}
}

func testHome(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp(".", "test-home-")
	if err != nil {
		t.Fatalf("creating test home: %v", err)
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		t.Fatalf("resolving test home: %v", err)
	}
	t.Cleanup(func() {
		if err := os.RemoveAll(abs); err != nil {
			t.Fatalf("cleaning test home %s: %v", abs, err)
		}
	})
	return abs
}
