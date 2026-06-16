package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

// NewSnapshotHandler returns a read-only HTTP handler for GET /api/snapshot.
// It marshals the current StateSnapshot to JSON on each request.
// If authToken is non-empty, requests must carry a matching Bearer token.
func NewSnapshotHandler(snapshotFn SnapshotFunc, authToken string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if authToken != "" {
			got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if got != authToken {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return
			}
		}
		snap := snapshotFn()
		snap.Type = protocol.TypeStateSnapshot
		snap.Ts = protocol.NowMs()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		json.NewEncoder(w).Encode(snap) //nolint:errcheck
	})
}
