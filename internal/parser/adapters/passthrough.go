package adapters

import "github.com/marcosaugustodev/cli-dm/internal/protocol"

// Passthrough is a no-op adapter that emits no parsed events.
// Raw output is still forwarded by the ingestion manager — this adapter
// simply doesn't try to extract structure from it.
type Passthrough struct{}

func NewPassthrough() *Passthrough {
	return &Passthrough{}
}

func (p *Passthrough) Name() string { return "passthrough" }

func (p *Passthrough) Feed(_ string, _ []byte) []protocol.Event {
	return nil
}

func (p *Passthrough) Flush(_ string) []protocol.Event {
	return nil
}
