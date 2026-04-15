package parser

import "github.com/marcosaugustodev/cli-dm/internal/protocol"

// Adapter parses raw CLI output into structured events.
// Implementations are stateful per-agent — they buffer partial lines
// and track the agent's current activity context.
type Adapter interface {
	// Name returns the adapter identifier (e.g., "claude", "passthrough")
	Name() string

	// Feed receives a chunk of raw output and returns any parsed events.
	// Chunks may contain partial lines; the adapter must buffer across calls.
	Feed(agentID string, chunk []byte) []protocol.Event

	// Flush returns any buffered events (call when the agent's process exits).
	Flush(agentID string) []protocol.Event
}
