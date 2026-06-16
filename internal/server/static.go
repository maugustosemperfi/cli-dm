package server

import (
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
)

// ResolveWebDist locates the built Vite output (web/dist).
// Checks next to the binary (bin/web/dist), repo root (../web/dist from bin/),
// and the current working directory.
func ResolveWebDist() string {
	var candidates []string
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "web", "dist"),
			filepath.Join(dir, "..", "web", "dist"),
		)
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(wd, "web", "dist"))
	}
	for _, p := range candidates {
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			if abs, err := filepath.Abs(p); err == nil {
				return abs
			}
			return p
		}
	}
	if len(candidates) > 0 {
		return candidates[0]
	}
	return "web/dist"
}

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
