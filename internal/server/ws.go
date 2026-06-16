package server

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"nhooyr.io/websocket"

	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

// EventStore is an optional interface for persisting broadcast events.
type EventStore interface {
	Write(ev protocol.Event) error
}

// SnapshotFunc returns the current full state for late-joining clients
type SnapshotFunc func() protocol.StateSnapshot

// CommandHandler processes commands received from browser clients.
type CommandHandler func(cmdType string, data json.RawMessage) error

// Hub manages WebSocket connections and broadcasts events
type Hub struct {
	mu             sync.RWMutex
	clients        map[*wsClient]struct{}
	snapshotFn     SnapshotFunc
	logger         *slog.Logger
	eventStore     EventStore     // optional session persistence
	commandHandler CommandHandler // optional handler for browser commands
}

type wsClient struct {
	conn *websocket.Conn
	send chan []byte
	done chan struct{}
}

// NewHub creates a WebSocket hub
func NewHub(snapshotFn SnapshotFunc, logger *slog.Logger) *Hub {
	return &Hub{
		clients:    make(map[*wsClient]struct{}),
		snapshotFn: snapshotFn,
		logger:     logger,
	}
}

// SetEventStore attaches a persistent event store to the hub.
// When set, every broadcast event is also written to the store.
func (h *Hub) SetEventStore(store EventStore) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.eventStore = store
}

// SetCommandHandler registers a handler for browser-to-server commands.
func (h *Hub) SetCommandHandler(handler CommandHandler) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.commandHandler = handler
}

// Broadcast sends an event to all connected clients
func (h *Hub) Broadcast(ev protocol.Event) {
	data, err := json.Marshal(ev)
	if err != nil {
		h.logger.Error("failed to marshal event for broadcast", "error", err)
		return
	}

	// Collect clients under lock; persistence is optional.
	h.mu.Lock()
	clients := make([]*wsClient, 0, len(h.clients))
	for c := range h.clients {
		clients = append(clients, c)
	}
	store := h.eventStore
	h.mu.Unlock()

	// Persist to event store if configured.
	if store != nil {
		if err := store.Write(ev); err != nil {
			h.logger.Error("failed to write event to store", "error", err)
		}
	}

	for _, c := range clients {
		select {
		case c.send <- data:
		default:
			// Client too slow, drop message
			h.logger.Warn("dropping message for slow client")
		}
	}
}

// ServeHTTP handles WebSocket upgrade requests
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // Allow connections from any origin (dev mode)
	})
	if err != nil {
		h.logger.Error("websocket accept failed", "error", err)
		return
	}

	client := &wsClient{
		conn: conn,
		send: make(chan []byte, 256),
		done: make(chan struct{}),
	}

	h.mu.Lock()
	h.clients[client] = struct{}{}
	h.mu.Unlock()

	h.logger.Info("client connected", "remote", r.RemoteAddr)

	// Send state snapshot to the new client
	snapshot := h.snapshotFn()
	snapshot.Type = protocol.TypeStateSnapshot
	snapshot.Ts = protocol.NowMs()
	if data, err := json.Marshal(snapshot); err == nil {
		select {
		case client.send <- data:
		default:
		}
	}

	// Start write pump
	go h.writePump(client)

	// Read pump (handles pings and detects disconnects)
	h.readPump(client)

	// Cleanup
	h.mu.Lock()
	delete(h.clients, client)
	h.mu.Unlock()
	close(client.done)
	conn.Close(websocket.StatusNormalClosure, "")
	h.logger.Info("client disconnected", "remote", r.RemoteAddr)
}

// writePump sends queued messages to the WebSocket connection
func (h *Hub) writePump(c *wsClient) {
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			err := c.conn.Write(ctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				h.logger.Debug("write failed", "error", err)
				return
			}
		case <-c.done:
			return
		}
	}
}

// readPump reads from the WebSocket and routes commands to the handler.
func (h *Hub) readPump(c *wsClient) {
	for {
		_, data, err := c.conn.Read(context.Background())
		if err != nil {
			return
		}

		// Parse the command type
		var envelope struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &envelope); err != nil {
			h.logger.Debug("ignoring malformed client message", "error", err)
			continue
		}

		h.mu.RLock()
		handler := h.commandHandler
		h.mu.RUnlock()

		if handler == nil {
			h.logger.Debug("no command handler registered, ignoring", "type", envelope.Type)
			continue
		}

		if err := handler(envelope.Type, data); err != nil {
			h.logger.Error("command handler failed", "type", envelope.Type, "error", err)
		}
	}
}

// ClientCount returns the number of connected clients
func (h *Hub) ClientCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.clients)
}
