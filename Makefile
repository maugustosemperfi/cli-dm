.PHONY: build build-go build-web dev dev-go dev-web dev-config dev-config-go clean run test

# Default target
build: build-go build-web

# Go backend
build-go:
	go build -o bin/cli-dm ./cmd/cli-dm

# Web frontend
build-web:
	cd web && npm run build

# Development mode: run Go server + Vite dev server concurrently
dev:
	@echo "Starting CLI_DM in dev mode..."
	@echo "  Go backend: http://localhost:8420"
	@echo "  Vite dev:   http://localhost:5173"
	@echo ""
	@$(MAKE) dev-go & $(MAKE) dev-web & wait

dev-go:
	go run ./cmd/cli-dm run \
		--agent "bash -c 'echo \"=== Blue Fighter: Refactoring Auth ===\"; for i in $$(seq 1 30); do echo \"[$$i/30] Reading src/auth/handler.go...\"; sleep 1; echo \"  Editing line $$((i * 3))...\"; sleep 0.5; done; echo \"git commit -m fix-auth\"; echo Done!'" \
		--agent "bash -c 'echo \"=== Red Rogue: Upgrading Types ===\"; for i in $$(seq 1 25); do echo \"[$$i/25] Processing types/index.ts...\"; sleep 1.2; if [ $$i -eq 12 ]; then echo \"Error: type mismatch at line 42\" >&2; sleep 2; echo \"  Retrying...\"; fi; done; echo Done!'" \
		--port 8420

dev-web:
	cd web && npx vite --port 5173

# Development mode with config file
dev-config:
	@echo "Starting CLI_DM with dungeon.yaml config..."
	@echo "  Go backend: http://localhost:8420"
	@echo "  Vite dev:   http://localhost:5173"
	@echo ""
	@$(MAKE) dev-config-go & $(MAKE) dev-web & wait

dev-config-go:
	go run ./cmd/cli-dm run --config examples/dungeon.yaml

# Development mode with live Claude Code integration
dev-live:
	@echo "Starting CLI_DM with live integration config..."
	@echo "  Go backend: http://localhost:8420"
	@echo "  Vite dev:   http://localhost:5173"
	@echo ""
	@$(MAKE) dev-live-go & $(MAKE) dev-web & wait

dev-live-go:
	go run ./cmd/cli-dm run --config examples/dungeon-live.yaml

# Watch all projects under ~/dev/nu/ with active Claude sessions
dev-watch:
	@echo "Starting CLI_DM watching ~/dev/nu/..."
	@echo "  Go backend: http://localhost:8420"
	@echo "  Vite dev:   http://localhost:5173"
	@echo ""
	@$(MAKE) dev-watch-go & $(MAKE) dev-web & wait

dev-watch-go:
	go run ./cmd/cli-dm run --config examples/dungeon-watch-all.yaml

# Run with custom agents
run: build-go
	./bin/cli-dm run $(ARGS)

# Tests
test: test-go test-web

test-go:
	go test ./... -v

test-web:
	cd web && npx tsc --noEmit

# Clean build artifacts
clean:
	rm -rf bin/
	rm -rf web/dist/
	rm -rf web/node_modules/.vite/

# Install dependencies
deps:
	go mod tidy
	cd web && npm install

# Full rebuild from scratch
rebuild: clean deps build
