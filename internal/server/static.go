package server

import (
	"io/fs"
	"net/http"
	"os"
)

// StaticHandler serves the built web frontend.
// In dev mode, Vite serves directly; this is for production builds.
func StaticHandler(webDistPath string) http.Handler {
	if info, err := os.Stat(webDistPath); err != nil || !info.IsDir() {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(200)
			w.Write([]byte(`<!DOCTYPE html>
<html><body>
<h2>CLI_DM</h2>
<p>Web frontend not built. Run <code>cd web && npm run build</code> or use dev mode.</p>
<p>In dev mode, the frontend runs on Vite's dev server (default port 5173).</p>
</body></html>`))
		})
	}

	fsys := os.DirFS(webDistPath)
	fileServer := http.FileServer(http.FS(fsys))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Try to serve the file. If it doesn't exist, serve index.html (SPA fallback).
		path := r.URL.Path
		if path == "/" {
			path = "index.html"
		} else {
			path = path[1:] // strip leading /
		}

		if _, err := fs.Stat(fsys, path); err != nil {
			r.URL.Path = "/"
		}
		fileServer.ServeHTTP(w, r)
	})
}
