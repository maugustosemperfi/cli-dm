package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

// SessionsConfig controls session recording and persistence.
type SessionsConfig struct {
	Enabled       bool   `yaml:"enabled"`
	Dir           string `yaml:"dir"`            // default: ~/.cli-dm/sessions
	RetentionDays int    `yaml:"retention_days"` // default: 30
}

// Config is the top-level dungeon.yaml structure.
type Config struct {
	Adapter   string          `yaml:"adapter"`
	Port      int             `yaml:"port"`
	Agents    []AgentConfig   `yaml:"agents"`
	Sessions  *SessionsConfig `yaml:"sessions"`
	HooksAuth string          `yaml:"hooks_auth"` // Auth token for hook receiver
	WatchDir  string          `yaml:"watch_dir"`  // Auto-discover projects with active Claude/Cursor sessions under this dir
	WatchAge  string          `yaml:"watch_age"`  // Max session age for auto-discovery (e.g. "24h", "7d"), default "24h"
}

// AgentConfig defines a single agent in the config file.
type AgentConfig struct {
	Name      string   `yaml:"name"`
	Role      string   `yaml:"role"`
	Command   string   `yaml:"command"`
	Task      string   `yaml:"task"`
	DependsOn []string `yaml:"depends_on"`

	// Multi-source support
	Source    string `yaml:"source"`     // "pty" (default), "stream-json", "hooks", "watch"
	WatchFile string `yaml:"watch_file"` // For source: watch — path to JSONL file/transcript
	Project   string `yaml:"project"`    // For source: watch — auto-discover sessions for this project dir
}

// LoadConfig reads and validates a dungeon.yaml file.
func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parsing config: %w", err)
	}

	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}

	return &cfg, nil
}

func (c *Config) validate() error {
	if len(c.Agents) == 0 && c.WatchDir == "" {
		return fmt.Errorf("at least one agent or watch_dir is required")
	}

	validRoles := map[string]bool{
		"warrior": true, "rogue": true, "mage": true,
		"ranger": true, "cleric": true, "bard": true,
	}
	validAdapters := map[string]bool{
		"claude": true, "passthrough": true, "stream-json": true, "": true,
	}
	validSources := map[string]bool{
		"pty": true, "stream-json": true, "hooks": true, "watch": true, "": true,
	}

	if !validAdapters[c.Adapter] {
		return fmt.Errorf("unknown adapter %q", c.Adapter)
	}

	taskNames := make(map[string]bool)
	for i, a := range c.Agents {
		src := strings.ToLower(a.Source)
		if !validSources[src] {
			return fmt.Errorf("agent %d: unknown source %q", i, a.Source)
		}
		// Command is required for pty and stream-json sources
		if (src == "" || src == "pty" || src == "stream-json") && a.Command == "" {
			return fmt.Errorf("agent %d: command is required for source %q", i, src)
		}
		// watch source requires watch_file or project
		if src == "watch" && a.WatchFile == "" && a.Project == "" {
			return fmt.Errorf("agent %d: watch source requires watch_file or project", i)
		}
		if a.Role != "" && !validRoles[strings.ToLower(a.Role)] {
			return fmt.Errorf("agent %d: unknown role %q", i, a.Role)
		}
		if a.Task != "" {
			if taskNames[a.Task] {
				return fmt.Errorf("agent %d: duplicate task name %q", i, a.Task)
			}
			taskNames[a.Task] = true
		}
	}

	// Validate depends_on references
	for i, a := range c.Agents {
		for _, dep := range a.DependsOn {
			if !taskNames[dep] {
				return fmt.Errorf("agent %d: depends_on references unknown task %q", i, dep)
			}
		}
	}

	return nil
}
