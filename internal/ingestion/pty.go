package ingestion

import (
	"io"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
)

// AgentProcess wraps a PTY-backed child process
type AgentProcess struct {
	ID      string
	Command *exec.Cmd
	ptmx    *os.File

	mu        sync.Mutex
	listeners []chan []byte
	done      chan struct{}
	exitCode  int
	err       error
}

// newAgentProcess creates a process but does not start it
func newAgentProcess(id string, name string, args []string) *AgentProcess {
	cmd := exec.Command(name, args...)
	cmd.Env = os.Environ()
	return &AgentProcess{
		ID:      id,
		Command: cmd,
		done:    make(chan struct{}),
	}
}

// Start launches the process in a PTY and begins reading output
func (ap *AgentProcess) Start() error {
	ptmx, err := pty.Start(ap.Command)
	if err != nil {
		return err
	}
	ap.ptmx = ptmx

	go ap.readLoop()
	go ap.waitLoop()
	return nil
}

// readLoop continuously reads from the PTY and broadcasts to listeners
func (ap *AgentProcess) readLoop() {
	buf := make([]byte, 4096)
	for {
		n, err := ap.ptmx.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			ap.broadcast(chunk)
		}
		if err != nil {
			if err != io.EOF {
				ap.mu.Lock()
				ap.err = err
				ap.mu.Unlock()
			}
			return
		}
	}
}

// waitLoop waits for the process to exit
func (ap *AgentProcess) waitLoop() {
	err := ap.Command.Wait()
	ap.mu.Lock()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			ap.exitCode = exitErr.ExitCode()
		} else {
			ap.exitCode = -1
			ap.err = err
		}
	}
	ap.mu.Unlock()
	ap.ptmx.Close()
	close(ap.done)
}

// broadcast sends a chunk to all registered listeners
func (ap *AgentProcess) broadcast(chunk []byte) {
	ap.mu.Lock()
	defer ap.mu.Unlock()
	for _, ch := range ap.listeners {
		select {
		case ch <- chunk:
		default:
			// Drop if listener is slow — prevents backpressure
		}
	}
}

// Subscribe returns a channel that receives output chunks.
// Buffer size controls how many chunks can queue before drops.
func (ap *AgentProcess) Subscribe(bufSize int) <-chan []byte {
	ch := make(chan []byte, bufSize)
	ap.mu.Lock()
	ap.listeners = append(ap.listeners, ch)
	ap.mu.Unlock()
	return ch
}

// Done returns a channel that closes when the process exits
func (ap *AgentProcess) Done() <-chan struct{} {
	return ap.done
}

// ExitCode returns the exit code (valid after Done closes)
func (ap *AgentProcess) ExitCode() int {
	ap.mu.Lock()
	defer ap.mu.Unlock()
	return ap.exitCode
}

// Kill sends SIGKILL to the process
func (ap *AgentProcess) Kill() error {
	if ap.Command.Process != nil {
		return ap.Command.Process.Kill()
	}
	return nil
}

// Write sends input to the PTY (e.g., for interactive processes)
func (ap *AgentProcess) Write(data []byte) (int, error) {
	if ap.ptmx == nil {
		return 0, io.ErrClosedPipe
	}
	return ap.ptmx.Write(data)
}
