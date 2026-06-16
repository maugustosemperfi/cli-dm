package ingestion

import (
	"sync"
	"time"
)

const coordinatedPollInterval = 250 * time.Millisecond

// WatcherCoordinator runs a single poll loop for all registered JSONL watchers,
// instead of one goroutine + ticker per file.
type WatcherCoordinator struct {
	mu       sync.Mutex
	watchers map[*JSONLWatcher]struct{}
	done     chan struct{}
}

var (
	globalWatcherCoordinator     *WatcherCoordinator
	globalWatcherCoordinatorOnce sync.Once
)

func sharedWatcherCoordinator() *WatcherCoordinator {
	globalWatcherCoordinatorOnce.Do(func() {
		c := &WatcherCoordinator{
			watchers: make(map[*JSONLWatcher]struct{}),
			done:     make(chan struct{}),
		}
		globalWatcherCoordinator = c
		go c.loop()
	})
	return globalWatcherCoordinator
}

func (c *WatcherCoordinator) register(w *JSONLWatcher) {
	c.mu.Lock()
	c.watchers[w] = struct{}{}
	c.mu.Unlock()
}

func (c *WatcherCoordinator) unregister(w *JSONLWatcher) {
	c.mu.Lock()
	delete(c.watchers, w)
	c.mu.Unlock()
}

func (c *WatcherCoordinator) loop() {
	ticker := time.NewTicker(coordinatedPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case <-ticker.C:
			c.mu.Lock()
			watchers := make([]*JSONLWatcher, 0, len(c.watchers))
			for w := range c.watchers {
				watchers = append(watchers, w)
			}
			c.mu.Unlock()
			for _, w := range watchers {
				w.poll()
			}
		}
	}
}
