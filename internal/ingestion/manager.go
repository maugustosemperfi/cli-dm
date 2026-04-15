package ingestion

import (
	"encoding/base64"
	"fmt"
	"log/slog"
	"sync"

	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

// EventSink receives parsed events from the ingestion layer
type EventSink func(protocol.Event)

// AgentConfig defines how to spawn an agent
type AgentConfig struct {
	ID      string
	Name    string
	Role    protocol.AgentRole
	Command string // Shell command to execute
	TaskID  string // Associated DAG node
}

// Manager orchestrates multiple agent processes
type Manager struct {
	mu        sync.RWMutex
	agents    map[string]*AgentProcess
	configs   map[string]AgentConfig
	eventSink EventSink
	logger    *slog.Logger
}

// NewManager creates a process manager
func NewManager(sink EventSink, logger *slog.Logger) *Manager {
	return &Manager{
		agents:    make(map[string]*AgentProcess),
		configs:   make(map[string]AgentConfig),
		eventSink: sink,
		logger:    logger,
	}
}

// SpawnAgent starts a new agent process
func (m *Manager) SpawnAgent(cfg AgentConfig) error {
	m.mu.Lock()
	if _, exists := m.agents[cfg.ID]; exists {
		m.mu.Unlock()
		return fmt.Errorf("agent %q already exists", cfg.ID)
	}

	// Run the full command string through the shell so quoting works
	if cfg.Command == "" {
		m.mu.Unlock()
		return fmt.Errorf("empty command for agent %q", cfg.ID)
	}

	proc := newAgentProcess(cfg.ID, "sh", []string{"-c", cfg.Command})
	m.agents[cfg.ID] = proc
	m.configs[cfg.ID] = cfg
	m.mu.Unlock()

	if err := proc.Start(); err != nil {
		m.mu.Lock()
		delete(m.agents, cfg.ID)
		delete(m.configs, cfg.ID)
		m.mu.Unlock()
		return fmt.Errorf("failed to start agent %q: %w", cfg.ID, err)
	}

	// Emit spawn event
	m.emit(protocol.AgentSpawn{
		Type:    protocol.TypeAgentSpawn,
		AgentID: cfg.ID,
		Name:    cfg.Name,
		Role:    cfg.Role,
		Command: cfg.Command,
		TaskID:  cfg.TaskID,
		Ts:      protocol.NowMs(),
	})

	// Start output forwarding goroutine
	outputCh := proc.Subscribe(256)
	go m.forwardOutput(cfg.ID, outputCh, proc.Done())

	// Start completion watcher
	go m.watchCompletion(cfg.ID, proc)

	m.logger.Info("agent spawned", "id", cfg.ID, "name", cfg.Name, "command", cfg.Command)
	return nil
}

// forwardOutput reads chunks from the process and emits raw.stdout events
func (m *Manager) forwardOutput(agentID string, ch <-chan []byte, done <-chan struct{}) {
	for {
		select {
		case chunk, ok := <-ch:
			if !ok {
				return
			}
			m.emit(protocol.RawStdout{
				Type:    protocol.TypeRawStdout,
				AgentID: agentID,
				Data:    base64.StdEncoding.EncodeToString(chunk),
				Ts:      protocol.NowMs(),
			})
		case <-done:
			// Drain remaining chunks
			for chunk := range ch {
				m.emit(protocol.RawStdout{
					Type:    protocol.TypeRawStdout,
					AgentID: agentID,
					Data:    base64.StdEncoding.EncodeToString(chunk),
					Ts:      protocol.NowMs(),
				})
			}
			return
		}
	}
}

// watchCompletion waits for a process to exit and emits the completion event
func (m *Manager) watchCompletion(agentID string, proc *AgentProcess) {
	<-proc.Done()
	exitCode := proc.ExitCode()

	if exitCode != 0 {
		m.emit(protocol.AgentError{
			Type:    protocol.TypeAgentError,
			AgentID: agentID,
			Message: fmt.Sprintf("process exited with code %d", exitCode),
			Ts:      protocol.NowMs(),
		})
	}

	m.emit(protocol.AgentComplete{
		Type:     protocol.TypeAgentComplete,
		AgentID:  agentID,
		ExitCode: exitCode,
		Ts:       protocol.NowMs(),
	})

	m.logger.Info("agent completed", "id", agentID, "exitCode", exitCode)
}

// KillAgent terminates a running agent
func (m *Manager) KillAgent(id string) error {
	m.mu.RLock()
	proc, ok := m.agents[id]
	m.mu.RUnlock()
	if !ok {
		return fmt.Errorf("agent %q not found", id)
	}
	return proc.Kill()
}

// AgentSnapshots returns snapshot data for all agents
func (m *Manager) AgentSnapshots() []protocol.AgentSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	snapshots := make([]protocol.AgentSnapshot, 0, len(m.agents))
	for id, proc := range m.agents {
		cfg := m.configs[id]
		snap := protocol.AgentSnapshot{
			AgentID: id,
			Name:    cfg.Name,
			Role:    cfg.Role,
		}

		select {
		case <-proc.Done():
			snap.IsComplete = true
			snap.ExitCode = proc.ExitCode()
			snap.CurrentAction = protocol.ActionIdle
		default:
			snap.CurrentAction = protocol.ActionShell // Default; parser will refine this
		}

		snapshots = append(snapshots, snap)
	}
	return snapshots
}

// WaitAll blocks until all agents have completed
func (m *Manager) WaitAll() {
	m.mu.RLock()
	agents := make([]*AgentProcess, 0, len(m.agents))
	for _, proc := range m.agents {
		agents = append(agents, proc)
	}
	m.mu.RUnlock()

	for _, proc := range agents {
		<-proc.Done()
	}
}

func (m *Manager) emit(v any) {
	ev, err := protocol.NewEvent(v)
	if err != nil {
		m.logger.Error("failed to create event", "error", err)
		return
	}
	m.eventSink(ev)
}
