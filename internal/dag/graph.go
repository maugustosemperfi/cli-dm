package dag

import (
	"fmt"
	"sync"

	"github.com/marcosaugustodev/cli-dm/internal/protocol"
)

// Node represents a task in the DAG
type Node struct {
	ID       string
	Label    string
	Status   protocol.NodeStatus
	Assignee string
}

// Edge represents a dependency: From must complete before To can start
type Edge struct {
	From string
	To   string
}

// Graph is a thread-safe directed acyclic graph of tasks
type Graph struct {
	mu    sync.RWMutex
	nodes map[string]*Node
	edges []Edge
	// adjacency: node ID → list of node IDs it points to
	outgoing map[string][]string
	// reverse adjacency: node ID → list of node IDs that point to it
	incoming map[string][]string
}

func New() *Graph {
	return &Graph{
		nodes:    make(map[string]*Node),
		outgoing: make(map[string][]string),
		incoming: make(map[string][]string),
	}
}

// AddNode adds a task node. Returns an error if it already exists.
func (g *Graph) AddNode(id, label, assignee string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, exists := g.nodes[id]; exists {
		return fmt.Errorf("node %q already exists", id)
	}
	g.nodes[id] = &Node{
		ID:       id,
		Label:    label,
		Status:   protocol.NodePending,
		Assignee: assignee,
	}
	return nil
}

// AddEdge adds a dependency edge. Returns error if it would create a cycle.
func (g *Graph) AddEdge(from, to string) error {
	g.mu.Lock()
	defer g.mu.Unlock()

	// Validate nodes exist
	if _, ok := g.nodes[from]; !ok {
		return fmt.Errorf("source node %q not found", from)
	}
	if _, ok := g.nodes[to]; !ok {
		return fmt.Errorf("target node %q not found", to)
	}

	// Check for cycles: if we can reach 'from' starting from 'to', adding this edge would create a cycle
	if g.canReach(to, from) {
		return fmt.Errorf("edge %s→%s would create a cycle", from, to)
	}

	g.edges = append(g.edges, Edge{From: from, To: to})
	g.outgoing[from] = append(g.outgoing[from], to)
	g.incoming[to] = append(g.incoming[to], from)
	return nil
}

// canReach checks if 'target' is reachable from 'start' via outgoing edges (DFS).
// Must be called with lock held.
func (g *Graph) canReach(start, target string) bool {
	visited := make(map[string]bool)
	stack := []string{start}
	for len(stack) > 0 {
		curr := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if curr == target {
			return true
		}
		if visited[curr] {
			continue
		}
		visited[curr] = true
		stack = append(stack, g.outgoing[curr]...)
	}
	return false
}

// RemoveNode removes a node and all edges that reference it. No-op if the node does not exist.
func (g *Graph) RemoveNode(id string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, ok := g.nodes[id]; !ok {
		return
	}
	delete(g.nodes, id)

	// Drop edges involving this node
	kept := g.edges[:0]
	for _, e := range g.edges {
		if e.From != id && e.To != id {
			kept = append(kept, e)
		}
	}
	g.edges = kept

	// Update neighbour adjacency lists
	for _, nb := range g.outgoing[id] {
		g.incoming[nb] = filterStrings(g.incoming[nb], id)
	}
	for _, nb := range g.incoming[id] {
		g.outgoing[nb] = filterStrings(g.outgoing[nb], id)
	}
	delete(g.outgoing, id)
	delete(g.incoming, id)
}

// filterStrings returns ss with all occurrences of exclude removed (in-place).
func filterStrings(ss []string, exclude string) []string {
	out := ss[:0]
	for _, s := range ss {
		if s != exclude {
			out = append(out, s)
		}
	}
	return out
}

// SetNodeStatus updates a node's status
func (g *Graph) SetNodeStatus(id string, status protocol.NodeStatus) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	node, ok := g.nodes[id]
	if !ok {
		return fmt.Errorf("node %q not found", id)
	}
	node.Status = status
	return nil
}

// GetNode returns a copy of a node
func (g *Graph) GetNode(id string) (Node, bool) {
	g.mu.RLock()
	defer g.mu.RUnlock()
	n, ok := g.nodes[id]
	if !ok {
		return Node{}, false
	}
	return *n, true
}

// Snapshot returns the current graph state for the state.snapshot event
func (g *Graph) Snapshot() protocol.DAGSnapshot {
	g.mu.RLock()
	defer g.mu.RUnlock()

	nodes := make([]protocol.DAGNodeSnapshot, 0, len(g.nodes))
	for _, n := range g.nodes {
		nodes = append(nodes, protocol.DAGNodeSnapshot{
			NodeID:   n.ID,
			Label:    n.Label,
			Status:   n.Status,
			Assignee: n.Assignee,
		})
	}

	edges := make([]protocol.DAGEdgeSnapshot, 0, len(g.edges))
	for _, e := range g.edges {
		edges = append(edges, protocol.DAGEdgeSnapshot{
			From: e.From,
			To:   e.To,
		})
	}

	return protocol.DAGSnapshot{Nodes: nodes, Edges: edges}
}

// LayerAssignment returns nodes grouped by layer for the Sugiyama layout.
// Layer 0 = roots (no incoming edges), layer N = nodes whose max dependency depth is N.
func (g *Graph) LayerAssignment() [][]string {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if len(g.nodes) == 0 {
		return nil
	}

	depth := make(map[string]int)
	var maxDepth int

	// Topological BFS to assign layers
	inDegree := make(map[string]int)
	for id := range g.nodes {
		inDegree[id] = len(g.incoming[id])
	}

	queue := make([]string, 0)
	for id, deg := range inDegree {
		if deg == 0 {
			queue = append(queue, id)
			depth[id] = 0
		}
	}

	for len(queue) > 0 {
		curr := queue[0]
		queue = queue[1:]
		for _, next := range g.outgoing[curr] {
			d := depth[curr] + 1
			if d > depth[next] {
				depth[next] = d
			}
			inDegree[next]--
			if inDegree[next] == 0 {
				queue = append(queue, next)
			}
			if depth[next] > maxDepth {
				maxDepth = depth[next]
			}
		}
	}

	layers := make([][]string, maxDepth+1)
	for id, d := range depth {
		layers[d] = append(layers[d], id)
	}
	return layers
}
