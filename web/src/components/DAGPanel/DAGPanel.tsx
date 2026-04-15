import { useGameState, AGENT_COLORS } from "../../stores/gameState";
import type { NodeStatus } from "../../protocol/events";

const STATUS_LABELS: Record<string, string> = {
  pending: "PENDING",
  in_progress: "ACTIVE",
  completed: "DONE",
  failed: "FAILED",
  blocked: "BLOCKED",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "#4e5058",
  in_progress: "#5b8abf",
  completed: "#5baf7b",
  failed: "#bf6b5b",
  blocked: "#bfa85b",
};

const SECTION_ORDER: NodeStatus[] = ["in_progress", "blocked", "pending", "completed", "failed"];

export function DAGPanel() {
  const dag = useGameState((s) => s.dag);
  const agents = useGameState((s) => s.agents);
  const selectAgent = useGameState((s) => s.selectAgent);
  const selectedAgent = useGameState((s) => s.selectedAgent);

  const completed = dag.nodes.filter((n) => n.status === "completed").length;
  const total = dag.nodes.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  // Group nodes by status
  const groups = new Map<NodeStatus, typeof dag.nodes>();
  for (const section of SECTION_ORDER) {
    groups.set(section, []);
  }
  for (const node of dag.nodes) {
    const group = groups.get(node.status);
    if (group) group.push(node);
    else groups.get("pending")!.push(node);
  }

  // Find dependencies for each node
  const deps = new Map<string, string[]>();
  for (const edge of dag.edges) {
    if (!deps.has(edge.to)) deps.set(edge.to, []);
    deps.get(edge.to)!.push(edge.from);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        fontFamily: "monospace",
      }}
    >
      {/* Progress header */}
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid #3f4147",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "#dbdee1",
            marginBottom: 6,
          }}
        >
          <span>Task Progress</span>
          <span>
            {completed}/{total} ({pct}%)
          </span>
        </div>
        {/* Progress bar */}
        <div
          style={{
            height: 6,
            borderRadius: 3,
            background: "#3f4147",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              background: pct === 100 ? "#5baf7b" : "#5b8abf",
              borderRadius: 3,
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>

      {/* Task list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {total === 0 ? (
          <div
            style={{
              color: "#6d6f78",
              padding: 20,
              textAlign: "center",
              fontSize: 12,
            }}
          >
            No tasks yet...
          </div>
        ) : (
          SECTION_ORDER.map((status) => {
            const nodes = groups.get(status) ?? [];
            if (nodes.length === 0) return null;
            return (
              <div key={status} style={{ marginBottom: 4 }}>
                {/* Section header */}
                <div
                  style={{
                    padding: "4px 10px",
                    fontSize: 10,
                    color: STATUS_COLORS[status] ?? "#4e5058",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  {STATUS_LABELS[status] ?? status} ({nodes.length})
                </div>

                {/* Task cards */}
                {nodes.map((node) => {
                  const agent = node.assignee
                    ? agents.get(node.assignee)
                    : undefined;
                  const isSelected = agent && selectedAgent === agent.agentId;
                  const agentColor = agent
                    ? AGENT_COLORS[agent.role] ?? "#8b9aab"
                    : "#6d6f78";
                  const nodeDeps = deps.get(node.nodeId) ?? [];
                  const depLabels = nodeDeps
                    .map((id) => dag.nodes.find((n) => n.nodeId === id)?.label)
                    .filter(Boolean);

                  return (
                    <div
                      key={node.nodeId}
                      onClick={() => {
                        if (node.assignee) selectAgent(node.assignee);
                      }}
                      style={{
                        padding: "6px 10px",
                        margin: "2px 6px",
                        borderRadius: 4,
                        background: isSelected
                          ? "rgba(91, 138, 191, 0.15)"
                          : "#2b2d31",
                        border: `1px solid ${isSelected ? agentColor : "#3f4147"}`,
                        cursor: node.assignee ? "pointer" : "default",
                      }}
                    >
                      {/* Task label + status dot */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: STATUS_COLORS[node.status] ?? "#4e5058",
                            flexShrink: 0,
                          }}
                        />
                        <span
                          style={{
                            fontSize: 12,
                            color: "#dbdee1",
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {node.label}
                        </span>
                      </div>

                      {/* Assignee */}
                      {agent && (
                        <div
                          style={{
                            fontSize: 10,
                            color: agentColor,
                            marginTop: 2,
                            paddingLeft: 14,
                          }}
                        >
                          {agent.name}
                          <span
                            style={{
                              color:
                                agent.currentAction === "idle"
                                  ? "#4e5058"
                                  : "#6d6f78",
                              fontStyle:
                                agent.currentAction === "idle"
                                  ? "italic"
                                  : "normal",
                            }}
                          >
                            {" "}— {agent.currentAction === "idle" ? "idle" : agent.currentAction}
                          </span>
                        </div>
                      )}

                      {/* Dependencies */}
                      {depLabels.length > 0 && (
                        <div
                          style={{
                            fontSize: 9,
                            color: "#6d6f78",
                            marginTop: 2,
                            paddingLeft: 14,
                          }}
                        >
                          depends on: {depLabels.join(", ")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
