package adapters

import (
	"bytes"
	"sync"

	"github.com/marcosaugustodev/cli-dm/internal/mapper"
	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

// StreamJSON implements parser.Adapter for Claude Code's stream-json output
// format (newline-delimited JSON). Each complete line is parsed via the
// shared mapper.ParseStreamLine function and then mapped through the Mapper
// to produce protocol events.
type StreamJSON struct {
	mp          *mapper.Mapper
	mu          sync.Mutex
	lineBuffers map[string][]byte
}

// NewStreamJSON creates a StreamJSON adapter backed by the given Mapper.
func NewStreamJSON(mp *mapper.Mapper) *StreamJSON {
	return &StreamJSON{
		mp:          mp,
		lineBuffers: make(map[string][]byte),
	}
}

func (s *StreamJSON) Name() string { return "stream-json" }

// Feed accumulates bytes and processes complete newline-delimited lines.
func (s *StreamJSON) Feed(agentID string, chunk []byte) []protocol.Event {
	s.mu.Lock()
	s.lineBuffers[agentID] = append(s.lineBuffers[agentID], chunk...)
	buf := s.lineBuffers[agentID]
	s.mu.Unlock()

	var events []protocol.Event

	for {
		idx := bytes.IndexByte(buf, '\n')
		if idx < 0 {
			break
		}
		line := buf[:idx]
		buf = buf[idx+1:]

		// Skip empty lines
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}

		toolEvents, err := mapper.ParseStreamLine(line, agentID)
		if err != nil {
			// Unparseable line — skip silently (raw output still flows via ingestion)
			continue
		}

		for _, te := range toolEvents {
			evts := s.mp.Map(te)
			events = append(events, evts...)
		}
	}

	s.mu.Lock()
	s.lineBuffers[agentID] = buf
	s.mu.Unlock()

	return events
}

// Flush processes any remaining bytes in the buffer for the given agent.
func (s *StreamJSON) Flush(agentID string) []protocol.Event {
	s.mu.Lock()
	buf := s.lineBuffers[agentID]
	delete(s.lineBuffers, agentID)
	s.mu.Unlock()

	if len(bytes.TrimSpace(buf)) == 0 {
		return nil
	}

	toolEvents, err := mapper.ParseStreamLine(buf, agentID)
	if err != nil {
		return nil
	}

	var events []protocol.Event
	for _, te := range toolEvents {
		evts := s.mp.Map(te)
		events = append(events, evts...)
	}
	return events
}
