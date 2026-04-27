package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"path/filepath"
	"strings"
	"syscall"
	"text/tabwriter"
	"time"

	"github.com/spf13/cobra"

	"github.com/marcosaugustodev/cli-dm/internal/config"
	"github.com/marcosaugustodev/cli-dm/internal/dag"
	"github.com/marcosaugustodev/cli-dm/internal/ingestion"
	"github.com/marcosaugustodev/cli-dm/internal/mapper"
	"github.com/marcosaugustodev/cli-dm/internal/parser"
	"github.com/marcosaugustodev/cli-dm/internal/parser/adapters"
	"github.com/marcosaugustodev/cli-dm/internal/protocol"
	"github.com/marcosaugustodev/cli-dm/internal/server"
	"github.com/marcosaugustodev/cli-dm/internal/storage"
)

var (
	port        int
	agentCmds   []string
	adapterName string
	configPath  string
	resumeID    string
	sessionsDir string
)

func main() {
	rootCmd := &cobra.Command{
		Use:   "cli-dm",
		Short: "AI Agent Dungeon Master — visualize parallel agent orchestration",
	}

	runCmd := &cobra.Command{
		Use:   "run",
		Short: "Launch agents and start the visualization server",
		RunE:  runServer,
	}

	runCmd.Flags().IntVarP(&port, "port", "p", 8420, "HTTP/WebSocket server port")
	runCmd.Flags().StringArrayVarP(&agentCmds, "agent", "a", nil, "Agent command to spawn (can be repeated)")
	runCmd.Flags().StringVar(&adapterName, "adapter", "passthrough", "Parser adapter: passthrough, claude")
	runCmd.Flags().StringVarP(&configPath, "config", "c", "", "Path to dungeon.yaml config file")
	runCmd.Flags().StringVar(&resumeID, "resume", "", "Resume a previous session by ID")

	rootCmd.AddCommand(runCmd)

	// Sessions subcommand group
	sessionsCmd := &cobra.Command{
		Use:   "sessions",
		Short: "Manage recorded sessions",
	}

	sessionsCmd.PersistentFlags().StringVar(&sessionsDir, "dir", "", "Sessions directory (default: ~/.cli-dm/sessions)")

	sessionsCmd.AddCommand(
		&cobra.Command{
			Use:   "list",
			Short: "List all recorded sessions",
			RunE:  sessionsListCmd,
		},
		&cobra.Command{
			Use:   "search <query>",
			Short: "Search sessions by ID, config, agent names, or task labels",
			Args:  cobra.ExactArgs(1),
			RunE:  sessionsSearchCmd,
		},
		&cobra.Command{
			Use:   "show <id>",
			Short: "Show details of a session",
			Args:  cobra.ExactArgs(1),
			RunE:  sessionsShowCmd,
		},
		&cobra.Command{
			Use:   "delete <id>",
			Short: "Delete a recorded session",
			Args:  cobra.ExactArgs(1),
			RunE:  sessionsDeleteCmd,
		},
		&cobra.Command{
			Use:   "clean",
			Short: "Delete sessions older than retention period (default 30 days)",
			RunE:  sessionsCleanCmd,
		},
	)

	rootCmd.AddCommand(sessionsCmd)

	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

// resolveSessionsDir returns the sessions base directory, expanding ~ if needed.
func resolveSessionsDir(override string) string {
	if override != "" {
		return expandHome(override)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	return filepath.Join(home, ".cli-dm", "sessions")
}

// parseAge parses a human-friendly duration string like "24h", "7d", "30m".
func parseAge(s string) (time.Duration, error) {
	s = strings.TrimSpace(s)
	if strings.HasSuffix(s, "d") {
		s = strings.TrimSuffix(s, "d")
		var days int
		if _, err := fmt.Sscanf(s, "%d", &days); err != nil {
			return 0, err
		}
		return time.Duration(days) * 24 * time.Hour, nil
	}
	return time.ParseDuration(s)
}

// expandHome replaces a leading ~ with the user's home directory.
func expandHome(path string) string {
	if strings.HasPrefix(path, "~/") || path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[1:])
	}
	return path
}

// generateSessionID creates a session ID in the format 20260415-143022-a7b3.
func generateSessionID() string {
	b := make([]byte, 2)
	if _, err := rand.Read(b); err != nil {
		// Fallback to time-based suffix if crypto/rand fails.
		b = []byte{byte(time.Now().Nanosecond() & 0xff), byte(time.Now().Nanosecond() >> 8 & 0xff)}
	}
	return time.Now().Format("20060102-150405") + "-" + hex.EncodeToString(b)
}

func runServer(cmd *cobra.Command, args []string) error {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))

	// Load config file if provided
	var fileCfg *config.Config
	if configPath != "" {
		var err error
		fileCfg, err = config.LoadConfig(configPath)
		if err != nil {
			return fmt.Errorf("loading config: %w", err)
		}
		// Config overrides flags
		if fileCfg.Adapter != "" {
			adapterName = fileCfg.Adapter
		}
		if fileCfg.Port != 0 {
			port = fileCfg.Port
		}
	}

	if fileCfg == nil && len(agentCmds) == 0 && resumeID == "" {
		return fmt.Errorf("either --config, --resume, or at least one --agent flag is required")
	}

	// Initialize DAG
	taskGraph := dag.New()

	// Select parser adapter
	var adapter parser.Adapter
	switch adapterName {
	case "claude":
		adapter = adapters.NewClaude()
	case "passthrough":
		adapter = adapters.NewPassthrough()
	default:
		return fmt.Errorf("unknown adapter: %s", adapterName)
	}

	// Create WebSocket hub
	var mgr *ingestion.Manager

	// Shared mapper + external agent tracking (declared early for snapshot closure)
	sharedMapper := mapper.New()
	externalAgentsMu := &sync.RWMutex{}
	externalAgents := make(map[string]struct {
		Name string
		Role protocol.AgentRole
	})

	buildSnapshot := func() protocol.StateSnapshot {
		// Merge PTY agent snapshots with external (watch/hooks) agent snapshots
		snaps := mgr.AgentSnapshots()
		externalAgentsMu.RLock()
		for id, ea := range externalAgents {
			snap := protocol.AgentSnapshot{
				AgentID: id,
				Name:    ea.Name,
				Role:    ea.Role,
			}
			// Get current action from mapper state if available
			if st := sharedMapper.GetState(id); st != nil {
				s := st.Snapshot()
				snap.CurrentAction = s.CurrentAction
				snap.CurrentDetail = s.CurrentDetail
				snap.IsBlocked = s.IsBlocked
				snap.ErrorCount = s.ErrorCount
			}
			snaps = append(snaps, snap)
		}
		externalAgentsMu.RUnlock()
		return protocol.StateSnapshot{
			Type:   protocol.TypeStateSnapshot,
			Agents: snaps,
			DAG:    taskGraph.Snapshot(),
			Ts:     protocol.NowMs(),
		}
	}

	hub := server.NewHub(buildSnapshot, logger)

	// --- Session persistence ---
	var eventStore *storage.FileEventStore

	sessionsEnabled := false
	var sessionsCfgDir string
	if fileCfg != nil && fileCfg.Sessions != nil {
		sessionsEnabled = fileCfg.Sessions.Enabled
		sessionsCfgDir = fileCfg.Sessions.Dir
	}

	if sessionsEnabled || resumeID != "" {
		baseDir := resolveSessionsDir(sessionsCfgDir)
		sessionID := resumeID
		if sessionID == "" {
			sessionID = generateSessionID()
		}

		// Collect agent and task info for meta.
		var agentNames []string
		var taskLabels []string
		if fileCfg != nil {
			for _, ac := range fileCfg.Agents {
				if ac.Name != "" {
					agentNames = append(agentNames, ac.Name)
				}
				if ac.Task != "" {
					taskLabels = append(taskLabels, ac.Task)
				}
			}
		}

		meta := storage.SessionMeta{
			ID:         sessionID,
			StartedAt:  time.Now(),
			ConfigFile: configPath,
			AgentCount: len(agentNames),
			TaskCount:  len(taskLabels),
			AgentNames: agentNames,
			TaskLabels: taskLabels,
		}

		var err error
		eventStore, err = storage.NewFileEventStore(sessionID, baseDir, meta)
		if err != nil {
			return fmt.Errorf("creating event store: %w", err)
		}
		defer eventStore.Close()

		hub.SetEventStore(eventStore)
		logger.Info("session recording started", "sessionID", sessionID, "dir", baseDir)
	}

	// Per-agent adapter map: agents can use different adapters
	agentAdapters := make(map[string]parser.Adapter)

	// Map agent IDs to task IDs for DAG status updates
	agentToTask := make(map[string]string)

	// Track watchers for cleanup
	var watchers []*ingestion.JSONLWatcher
	var watchersMu sync.Mutex

	// Track JSONL paths already being watched — used by the periodic
	// rediscovery goroutine to avoid double-watching the same session.
	watchedPaths := make(map[string]bool)
	var watchedPathsMu sync.Mutex

	// Counter for agent IDs assigned to sessions discovered after startup
	// (new terminals opened while cli-dm is already running).
	lateAgentCounter := 0

	// registerWatcher takes ownership of `w` for cleanup purposes. It appends
	// w to `watchers` and sets a SetOnStop callback that releases
	// watchedPaths[path] and the watchers entry once the poll/sweep goroutines
	// exit — which happens when the watcher auto-completes after 30 min of
	// idle. Releasing watchedPaths lets the 30s rediscovery ticker re-engage
	// the session as a fresh late-N agent if the JSONL resumes activity.
	//
	// extraCleanup (optional) is called after path/watcher cleanup — use it to
	// remove the agent from externalAgents and its DAG node from taskGraph.
	//
	// The caller must have already claimed watchedPaths[path] = true. Returns
	// an idempotent release func to invoke manually if Start fails (goroutine
	// never ran, so onStop wouldn't fire).
	registerWatcher := func(path string, w *ingestion.JSONLWatcher, extraCleanup func()) func() {
		watchersMu.Lock()
		watchers = append(watchers, w)
		watchersMu.Unlock()

		var once sync.Once
		release := func() {
			once.Do(func() {
				watchedPathsMu.Lock()
				delete(watchedPaths, path)
				watchedPathsMu.Unlock()

				watchersMu.Lock()
				for i, ww := range watchers {
					if ww == w {
						watchers = append(watchers[:i], watchers[i+1:]...)
						break
					}
				}
				watchersMu.Unlock()

				if extraCleanup != nil {
					extraCleanup()
				}

				logger.Info("watcher released", "path", path)
			})
		}

		w.SetOnStop(release)
		return release
	}

	// makeWatcherCleanup returns a closure that removes the given agent from
	// externalAgents, drops its DAG node, then broadcasts a fresh state.snapshot
	// so connected clients immediately see the building disappear.
	makeWatcherCleanup := func(agentID, taskID string) func() {
		return func() {
			externalAgentsMu.Lock()
			delete(externalAgents, agentID)
			externalAgentsMu.Unlock()
			taskGraph.RemoveNode(taskID)
			if snapEv, err := protocol.NewEvent(buildSnapshot()); err == nil {
				hub.Broadcast(snapEv)
			}
		}
	}

	// Event pipeline: ingestion -> parser -> hub broadcast
	eventSink := func(ev protocol.Event) {
		// Feed raw output through the per-agent or global adapter
		if ev.Type == protocol.TypeRawStdout {
			var raw protocol.RawStdout
			if err := json.Unmarshal(ev.RawJSON(), &raw); err == nil {
				if decoded, err := base64.StdEncoding.DecodeString(raw.Data); err == nil {
					// Use per-agent adapter if set, otherwise global
					a := agentAdapters[raw.AgentID]
					if a == nil {
						a = adapter
					}
					parsedEvents := a.Feed(raw.AgentID, decoded)
					for _, parsed := range parsedEvents {
						hub.Broadcast(parsed)
					}
				}
			}
		}

		// When an agent spawns, register for snapshots + mark DAG node
		if ev.Type == protocol.TypeAgentSpawn {
			var spawn protocol.AgentSpawn
			if err := json.Unmarshal(ev.RawJSON(), &spawn); err == nil {
				// Auto-register dynamically spawned agents (subagents from watchers)
				externalAgentsMu.Lock()
				if _, exists := externalAgents[spawn.AgentID]; !exists {
					externalAgents[spawn.AgentID] = struct {
						Name string
						Role protocol.AgentRole
					}{spawn.Name, spawn.Role}
				}
				externalAgentsMu.Unlock()

				if spawn.TaskID != "" {
					agentToTask[spawn.AgentID] = spawn.TaskID
					taskGraph.SetNodeStatus(spawn.TaskID, protocol.NodeInProgress)
					statusEv, _ := protocol.NewEvent(protocol.DAGNodeStatus{
						Type:   protocol.TypeDAGNodeStatus,
						NodeID: spawn.TaskID,
						Status: protocol.NodeInProgress,
						Ts:     protocol.NowMs(),
					})
					hub.Broadcast(statusEv)
				}
			}
		}

		// When an agent completes, mark its DAG node as completed/failed
		if ev.Type == protocol.TypeAgentComplete {
			var complete protocol.AgentComplete
			if err := json.Unmarshal(ev.RawJSON(), &complete); err == nil {
				if taskID, ok := agentToTask[complete.AgentID]; ok {
					status := protocol.NodeCompleted
					if complete.ExitCode != 0 {
						status = protocol.NodeFailed
					}
					taskGraph.SetNodeStatus(taskID, status)
					statusEv, _ := protocol.NewEvent(protocol.DAGNodeStatus{
						Type:   protocol.TypeDAGNodeStatus,
						NodeID: taskID,
						Status: status,
						Ts:     protocol.NowMs(),
					})
					hub.Broadcast(statusEv)
				}
			}
		}

		// Always broadcast the original event
		hub.Broadcast(ev)
	}

	// Create process manager
	mgr = ingestion.NewManager(eventSink, logger)

	// Register command handler for browser-to-server commands
	hub.SetCommandHandler(func(cmdType string, data json.RawMessage) error {
		switch cmdType {
		case protocol.TypeCmdAgentKill:
			var cmd protocol.CmdAgentKill
			if err := json.Unmarshal(data, &cmd); err != nil {
				return fmt.Errorf("parsing kill command: %w", err)
			}
			logger.Info("command: kill agent", "agentId", cmd.AgentID)
			return mgr.KillAgent(cmd.AgentID)

		case protocol.TypeCmdAgentSignal:
			var cmd protocol.CmdAgentSignal
			if err := json.Unmarshal(data, &cmd); err != nil {
				return fmt.Errorf("parsing signal command: %w", err)
			}
			logger.Info("command: signal agent", "agentId", cmd.AgentID, "signal", cmd.Signal)
			if cmd.Signal == "interrupt" {
				return mgr.KillAgent(cmd.AgentID) // simplified: interrupt = kill for now
			}
			return nil

		default:
			logger.Debug("unknown command type", "type", cmdType)
			return nil
		}
	})

	// Default roles for round-robin assignment
	defaultRoles := []protocol.AgentRole{
		protocol.RoleWarrior,
		protocol.RoleRogue,
		protocol.RoleMage,
		protocol.RoleRanger,
		protocol.RoleCleric,
		protocol.RoleBard,
	}
	defaultRoleNames := map[protocol.AgentRole]string{
		protocol.RoleWarrior: "Blue Fighter",
		protocol.RoleRogue:   "Red Rogue",
		protocol.RoleMage:    "Purple Mage",
		protocol.RoleRanger:  "Green Ranger",
		protocol.RoleCleric:  "Gold Cleric",
		protocol.RoleBard:    "Silver Bard",
	}

	// Hook receiver — created if any agent uses hooks source
	var hookReceiver *ingestion.HookReceiver

	if fileCfg != nil {
		// Check if any agent uses hooks source
		for _, ac := range fileCfg.Agents {
			if strings.ToLower(ac.Source) == "hooks" {
				hookReceiver = ingestion.NewHookReceiver(sharedMapper, eventSink, fileCfg.HooksAuth, logger)
				break
			}
		}

		// Config-based agent spawning
		taskLabelToID := make(map[string]string) // task label -> task node ID

		for i, ac := range fileCfg.Agents {
			agentID := fmt.Sprintf("t%d", i+1)
			taskID := fmt.Sprintf("task-%d", i+1)

			role := protocol.AgentRole(strings.ToLower(ac.Role))
			if ac.Role == "" {
				role = defaultRoles[i%len(defaultRoles)]
			}
			name := ac.Name
			if name == "" {
				name = defaultRoleNames[role]
			}
			taskLabel := ac.Task
			if taskLabel == "" {
				taskLabel = fmt.Sprintf("Task %d", i+1)
			}

			taskGraph.AddNode(taskID, taskLabel, agentID)
			taskLabelToID[taskLabel] = taskID

			src := strings.ToLower(ac.Source)
			switch src {
			case "", "pty":
				// Original behavior: spawn via PTY with global adapter
				cfg := ingestion.AgentConfig{
					ID:      agentID,
					Name:    name,
					Role:    role,
					Command: ac.Command,
					TaskID:  taskID,
				}
				if err := mgr.SpawnAgent(cfg); err != nil {
					logger.Error("failed to spawn agent", "id", agentID, "error", err)
					return err
				}

			case "stream-json":
				// Spawn via PTY but use StreamJSON adapter
				sjAdapter := adapters.NewStreamJSON(sharedMapper)
				agentAdapters[agentID] = sjAdapter
				cfg := ingestion.AgentConfig{
					ID:      agentID,
					Name:    name,
					Role:    role,
					Command: ac.Command,
					TaskID:  taskID,
				}
				if err := mgr.SpawnAgent(cfg); err != nil {
					logger.Error("failed to spawn agent", "id", agentID, "error", err)
					return err
				}

			case "hooks":
				// No process to spawn — receive events via HTTP
				if hookReceiver != nil {
					hookReceiver.RegisterAgent(agentID, name, role)
				}
				// Track for snapshot on reconnect
				externalAgentsMu.Lock()
				externalAgents[agentID] = struct{ Name string; Role protocol.AgentRole }{name, role}
				externalAgentsMu.Unlock()
				// Emit spawn event manually
				spawnEv, _ := protocol.NewEvent(protocol.AgentSpawn{
					Type:    protocol.TypeAgentSpawn,
					AgentID: agentID,
					Name:    name,
					Role:    role,
					TaskID:  taskID,
					Ts:      protocol.NowMs(),
				})
				eventSink(spawnEv)

			case "watch":
				// Tail JSONL log file(s). If project is set, discover ALL active sessions.
				if ac.WatchFile != "" {
					// Explicit file path — single watcher
					watchPath := expandHome(ac.WatchFile)
					externalAgentsMu.Lock()
					externalAgents[agentID] = struct{ Name string; Role protocol.AgentRole }{name, role}
					externalAgentsMu.Unlock()

					w := ingestion.NewJSONLWatcher(watchPath, agentID, sharedMapper, eventSink, logger)
					watchedPaths[watchPath] = true
					release := registerWatcher(watchPath, w, makeWatcherCleanup(agentID, taskID))
					if err := w.Start(false); err != nil {
						logger.Error("failed to start watcher", "id", agentID, "error", err)
						release()
						return err
					}

					spawnEv, _ := protocol.NewEvent(protocol.AgentSpawn{
						Type:    protocol.TypeAgentSpawn,
						AgentID: agentID,
						Name:    name,
						Role:    role,
						TaskID:  taskID,
						Ts:      protocol.NowMs(),
					})
					eventSink(spawnEv)
				} else if ac.Project != "" {
					// Discover ALL active sessions for this project
					sessions, err := ingestion.DiscoverActiveSessions(expandHome(ac.Project), 4*time.Hour)
					if err != nil {
						logger.Error("failed to discover sessions", "project", ac.Project, "error", err)
						return fmt.Errorf("agent %d: %w", i, err)
					}
					if len(sessions) == 0 {
						logger.Warn("no active sessions found for project", "project", ac.Project)
						continue
					}

					for si, sess := range sessions {
						subAgentID := agentID
						subName := name
						subTaskID := taskID
						subRole := role
						if si > 0 {
							// Additional sessions get unique IDs
							subAgentID = fmt.Sprintf("%s.%d", agentID, si)
							subName = fmt.Sprintf("%s #%d", name, si+1)
							subTaskID = fmt.Sprintf("%s-%d", taskID, si)
							subRole = defaultRoles[(i+si)%len(defaultRoles)]
							taskGraph.AddNode(subTaskID, subName, subAgentID)
						}

						externalAgentsMu.Lock()
						externalAgents[subAgentID] = struct{ Name string; Role protocol.AgentRole }{subName, subRole}
						externalAgentsMu.Unlock()

						w := ingestion.NewJSONLWatcher(sess.Path, subAgentID, sharedMapper, eventSink, logger)
						watchedPaths[sess.Path] = true
						release := registerWatcher(sess.Path, w, makeWatcherCleanup(subAgentID, subTaskID))
						if err := w.Start(false); err != nil {
							logger.Error("failed to start watcher", "id", subAgentID, "error", err)
							release()
							continue
						}

						spawnEv, _ := protocol.NewEvent(protocol.AgentSpawn{
							Type:    protocol.TypeAgentSpawn,
							AgentID: subAgentID,
							Name:    subName,
							Role:    subRole,
							TaskID:  subTaskID,
							Ts:      protocol.NowMs(),
						})
						eventSink(spawnEv)

						logger.Info("watching session", "agent", subAgentID, "path", sess.Path,
							"age", time.Since(sess.ModTime).Truncate(time.Minute))
					}
				}
			}
		}

		// Build DAG edges from depends_on
		for i, ac := range fileCfg.Agents {
			taskID := fmt.Sprintf("task-%d", i+1)
			for _, dep := range ac.DependsOn {
				depID, ok := taskLabelToID[dep]
				if !ok {
					logger.Warn("depends_on references unknown task", "task", ac.Task, "dep", dep)
					continue
				}
				if err := taskGraph.AddEdge(depID, taskID); err != nil {
					logger.Warn("failed to add DAG edge", "from", depID, "to", taskID, "error", err)
				}
			}
		}

		// Auto-discover projects with active sessions from watch_dir
		if fileCfg.WatchDir != "" {
			maxAge := 24 * time.Hour // default
			if fileCfg.WatchAge != "" {
				if parsed, err := parseAge(fileCfg.WatchAge); err == nil {
					maxAge = parsed
				} else {
					logger.Warn("invalid watch_age, using 24h", "value", fileCfg.WatchAge, "error", err)
				}
			}

			watchDir := expandHome(fileCfg.WatchDir)
			projects, err := ingestion.DiscoverProjectsInDir(watchDir, maxAge)
			if err != nil {
				logger.Error("watch_dir discovery failed", "dir", watchDir, "error", err)
			} else {
				logger.Info("discovered projects with active sessions", "dir", watchDir, "count", len(projects))
				baseIdx := len(fileCfg.Agents) // offset agent IDs to avoid collision
				for j, proj := range projects {
					idx := baseIdx + j
					agentID := fmt.Sprintf("t%d", idx+1)
					taskID := fmt.Sprintf("task-%d", idx+1)
					role := defaultRoles[idx%len(defaultRoles)]
					name := proj.ProjectName

					taskGraph.AddNode(taskID, name, agentID)

					// Track for snapshot on reconnect
					externalAgentsMu.Lock()
					externalAgents[agentID] = struct{ Name string; Role protocol.AgentRole }{name, role}
					externalAgentsMu.Unlock()

					w := ingestion.NewJSONLWatcher(proj.SessionPath, agentID, sharedMapper, eventSink, logger)
					watchedPaths[proj.SessionPath] = true
					release := registerWatcher(proj.SessionPath, w, makeWatcherCleanup(agentID, taskID))
					if err := w.Start(false); err != nil {
						logger.Error("failed to start watcher", "project", name, "error", err)
						release()
						continue
					}

					spawnEv, _ := protocol.NewEvent(protocol.AgentSpawn{
						Type:    protocol.TypeAgentSpawn,
						AgentID: agentID,
						Name:    name,
						Role:    role,
						TaskID:  taskID,
						Ts:      protocol.NowMs(),
					})
					eventSink(spawnEv)

					logger.Info("watching project", "name", name, "session", proj.SessionPath, "age", time.Since(proj.ModTime).Truncate(time.Minute))
				}
			}
		}
	} else if resumeID == "" {
		// Flag-based agent spawning (legacy)
		for i, cmdStr := range agentCmds {
			role := defaultRoles[i%len(defaultRoles)]
			agentID := fmt.Sprintf("t%d", i+1)
			taskID := fmt.Sprintf("task-%d", i+1)

			taskGraph.AddNode(taskID, fmt.Sprintf("Task %d", i+1), agentID)

			cfg := ingestion.AgentConfig{
				ID:      agentID,
				Name:    defaultRoleNames[role],
				Role:    role,
				Command: cmdStr,
				TaskID:  taskID,
			}

			if err := mgr.SpawnAgent(cfg); err != nil {
				logger.Error("failed to spawn agent", "id", agentID, "error", err)
				return err
			}
		}
	}

	// --- Resume: replay events from previous session ---
	if resumeID != "" {
		baseDir := resolveSessionsDir(sessionsCfgDir)
		sm := storage.NewSessionManager(baseDir)
		meta, err := sm.GetSession(resumeID)
		if err != nil {
			return fmt.Errorf("loading session %s: %w", resumeID, err)
		}

		// Use a temporary store to read events.
		tmpStore, err := storage.NewFileEventStore(resumeID, baseDir, *meta)
		if err != nil {
			return fmt.Errorf("opening session store: %w", err)
		}
		events, err := tmpStore.ReadAll(resumeID)
		tmpStore.Close()
		if err != nil {
			return fmt.Errorf("reading session events: %w", err)
		}

		logger.Info("replaying session", "id", resumeID, "events", len(events))
		for _, ev := range events {
			// Replay through the hub to rebuild state.
			hub.Broadcast(ev)
		}
	}

	// Clean up watchers on exit. Copy the slice under lock so release
	// callbacks (which rewrite `watchers`) can't corrupt iteration.
	defer func() {
		watchersMu.Lock()
		ws := make([]*ingestion.JSONLWatcher, len(watchers))
		copy(ws, watchers)
		watchersMu.Unlock()
		for _, w := range ws {
			w.Stop()
		}
	}()

	// Set up HTTP server
	mux := http.NewServeMux()
	mux.Handle("/api/ws", hub)

	// Mount hook receiver if any agent uses hooks source
	if hookReceiver != nil {
		mux.Handle("/api/hooks", hookReceiver)
		mux.Handle("/api/hooks/register", hookReceiver.RegisterHandler())
		logger.Info("hook receiver mounted", "endpoint", "/api/hooks")
	}

	// Serve static files from web/dist if it exists
	exePath, _ := os.Executable()
	webDist := filepath.Join(filepath.Dir(exePath), "web", "dist")
	mux.Handle("/", server.StaticHandler(webDist))

	srv := &http.Server{
		Addr:    fmt.Sprintf(":%d", port),
		Handler: mux,
	}

	// Graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-sigCh
		logger.Info("shutting down...")
		cancel()
		srv.Shutdown(context.Background())
	}()

	// Periodic session rediscovery — picks up JSONL files created after
	// startup (e.g. new Claude Code sessions opened in other terminals).
	if fileCfg != nil {
		spawnLateWatcher := func(path, name string, role protocol.AgentRole) {
			watchedPathsMu.Lock()
			if watchedPaths[path] {
				watchedPathsMu.Unlock()
				return
			}
			watchedPaths[path] = true
			lateAgentCounter++
			counter := lateAgentCounter
			watchedPathsMu.Unlock()

			agentID := fmt.Sprintf("late-%d", counter)
			taskID := fmt.Sprintf("late-task-%d", counter)
			taskGraph.AddNode(taskID, name, agentID)

			externalAgentsMu.Lock()
			externalAgents[agentID] = struct {
				Name string
				Role protocol.AgentRole
			}{name, role}
			externalAgentsMu.Unlock()

			w := ingestion.NewJSONLWatcher(path, agentID, sharedMapper, eventSink, logger)
			// watchedPaths[path] was already reserved above under the mutex.
			release := registerWatcher(path, w, makeWatcherCleanup(agentID, taskID))
			if err := w.Start(false); err != nil {
				logger.Error("failed to start late watcher", "path", path, "error", err)
				release()
				return
			}

			spawnEv, _ := protocol.NewEvent(protocol.AgentSpawn{
				Type:    protocol.TypeAgentSpawn,
				AgentID: agentID,
				Name:    name,
				Role:    role,
				TaskID:  taskID,
				Ts:      protocol.NowMs(),
			})
			eventSink(spawnEv)

			// Broadcast full state.snapshot so the frontend picks up the new
			// DAG node and renders a building/house + connecting roads for it.
			// AgentSpawn alone does not mutate the DAG on the client side.
			if snapEv, err := protocol.NewEvent(buildSnapshot()); err == nil {
				hub.Broadcast(snapEv)
			}

			logger.Info("discovered new session", "agent", agentID, "path", path, "name", name)
		}

		go func() {
			ticker := time.NewTicker(30 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					// Rediscovery uses StaleIdleThreshold (30min) — tighter than
					// the startup filter — so a JSONL whose watcher was just
					// auto-completed at 30min idle doesn't immediately re-qualify
					// and loop. If the user resumes the session, its mtime jumps
					// forward and this filter will include it again.
					rediscoverMaxAge := ingestion.StaleIdleThreshold

					// Re-check each "watch" agent with Project set
					for i, ac := range fileCfg.Agents {
						if strings.ToLower(ac.Source) != "watch" || ac.Project == "" {
							continue
						}
						sessions, err := ingestion.DiscoverActiveSessions(expandHome(ac.Project), rediscoverMaxAge)
						if err != nil {
							continue
						}
						baseName := ac.Name
						if baseName == "" {
							baseName = defaultRoleNames[defaultRoles[i%len(defaultRoles)]]
						}
						baseRole := protocol.AgentRole(strings.ToLower(ac.Role))
						if ac.Role == "" {
							baseRole = defaultRoles[i%len(defaultRoles)]
						}
						for _, sess := range sessions {
							spawnLateWatcher(sess.Path, baseName, baseRole)
						}
					}

					// Re-scan watch_dir using the same tight filter.
					if fileCfg.WatchDir != "" {
						projects, err := ingestion.DiscoverProjectsInDir(expandHome(fileCfg.WatchDir), rediscoverMaxAge)
						if err != nil {
							continue
						}
						for j, proj := range projects {
							role := defaultRoles[j%len(defaultRoles)]
							spawnLateWatcher(proj.SessionPath, proj.ProjectName, role)
						}
					}
				}
			}
		}()
	}

	agentCount := len(agentCmds)
	if fileCfg != nil {
		agentCount = len(fileCfg.Agents)
	}

	logger.Info("CLI_DM server starting",
		"port", port,
		"agents", agentCount,
		"adapter", adapterName,
	)
	fmt.Fprintf(os.Stderr, "\n  Dungeon Master ready at http://localhost:%d\n", port)
	fmt.Fprintf(os.Stderr, "  WebSocket endpoint: ws://localhost:%d/api/ws\n", port)
	fmt.Fprintf(os.Stderr, "  Agents: %d | Adapter: %s\n\n", agentCount, adapterName)

	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		return err
	}

	// Wait for all agents to complete
	_ = ctx
	mgr.WaitAll()
	return nil
}

// --- Sessions subcommands ---

func getSessionManager() *storage.SessionManager {
	return storage.NewSessionManager(resolveSessionsDir(sessionsDir))
}

func sessionsListCmd(cmd *cobra.Command, args []string) error {
	sm := getSessionManager()
	sessions, err := sm.ListSessions()
	if err != nil {
		return err
	}

	if len(sessions) == 0 {
		fmt.Println("No sessions found.")
		return nil
	}

	printSessionsTable(sessions)
	return nil
}

func sessionsSearchCmd(cmd *cobra.Command, args []string) error {
	sm := getSessionManager()
	sessions, err := sm.SearchSessions(args[0])
	if err != nil {
		return err
	}

	if len(sessions) == 0 {
		fmt.Printf("No sessions matching %q.\n", args[0])
		return nil
	}

	printSessionsTable(sessions)
	return nil
}

func sessionsShowCmd(cmd *cobra.Command, args []string) error {
	sm := getSessionManager()
	meta, err := sm.GetSession(args[0])
	if err != nil {
		return err
	}

	fmt.Printf("Session: %s\n", meta.ID)
	fmt.Printf("Status:  %s\n", meta.Status)
	fmt.Printf("Started: %s\n", meta.StartedAt.Format(time.RFC3339))
	if !meta.EndedAt.IsZero() {
		fmt.Printf("Ended:   %s\n", meta.EndedAt.Format(time.RFC3339))
		fmt.Printf("Duration: %s\n", meta.EndedAt.Sub(meta.StartedAt).Truncate(time.Second))
	}
	if meta.ConfigFile != "" {
		fmt.Printf("Config:  %s\n", meta.ConfigFile)
	}
	fmt.Printf("Agents:  %d\n", meta.AgentCount)
	fmt.Printf("Tasks:   %d\n", meta.TaskCount)
	fmt.Printf("Events:  %d\n", meta.EventCount)
	if len(meta.AgentNames) > 0 {
		fmt.Printf("Agent Names: %s\n", strings.Join(meta.AgentNames, ", "))
	}
	if len(meta.TaskLabels) > 0 {
		fmt.Printf("Task Labels: %s\n", strings.Join(meta.TaskLabels, ", "))
	}

	return nil
}

func sessionsDeleteCmd(cmd *cobra.Command, args []string) error {
	sm := getSessionManager()

	// Confirm deletion.
	fmt.Printf("Delete session %s? [y/N] ", args[0])
	var answer string
	fmt.Scanln(&answer)
	if strings.ToLower(strings.TrimSpace(answer)) != "y" {
		fmt.Println("Cancelled.")
		return nil
	}

	if err := sm.DeleteSession(args[0]); err != nil {
		return err
	}
	fmt.Printf("Session %s deleted.\n", args[0])
	return nil
}

func sessionsCleanCmd(cmd *cobra.Command, args []string) error {
	sm := getSessionManager()
	retentionDays := 30
	if err := sm.CleanOldSessions(retentionDays); err != nil {
		return err
	}
	fmt.Printf("Cleaned sessions older than %d days.\n", retentionDays)
	return nil
}

func printSessionsTable(sessions []storage.SessionMeta) {
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "ID\tSTATUS\tAGENTS\tTASKS\tEVENTS\tSTARTED")
	for _, s := range sessions {
		fmt.Fprintf(w, "%s\t%s\t%d\t%d\t%d\t%s\n",
			s.ID,
			s.Status,
			s.AgentCount,
			s.TaskCount,
			s.EventCount,
			s.StartedAt.Format("2006-01-02 15:04:05"),
		)
	}
	w.Flush()
}
