import type { GameEvent } from "../protocol/events";
import type { AgentState, TranscriptEntry, TimelineSegment } from "./gameState";

const MAX_TRANSCRIPT = 1000;

function agentMeta(
  agentId: string,
  agents: Map<string, AgentState>,
  spawnCache: Map<string, { name?: string; role?: string }>,
): { name?: string; role?: string } {
  const live = agents.get(agentId);
  if (live) return { name: live.name, role: live.role };
  return spawnCache.get(agentId) ?? {};
}

/** Rebuild transcript entries from the event ring (lazy — call on render). */
export function deriveTranscript(
  events: GameEvent[],
  agents: Map<string, AgentState>,
): TranscriptEntry[] {
  const spawnCache = new Map<string, { name?: string; role?: string }>();
  const entries: TranscriptEntry[] = [];

  for (const event of events) {
    const ts = "ts" in event && event.ts != null ? event.ts : Date.now();

    switch (event.type) {
      case "agent.spawn":
        spawnCache.set(event.agentId, { name: event.name, role: event.role });
        entries.push({
          ts,
          agentId: event.agentId,
          agentName: event.name,
          agentRole: event.role,
          kind: "spawn",
          message: `joined the dungeon as ${event.role}`,
        });
        break;

      case "agent.complete": {
        const meta = agentMeta(event.agentId, agents, spawnCache);
        entries.push({
          ts,
          agentId: event.agentId,
          agentName: meta.name,
          agentRole: meta.role,
          kind: "complete",
          message: `completed (exit ${event.exitCode})`,
        });
        break;
      }

      case "agent.error": {
        const meta = agentMeta(event.agentId, agents, spawnCache);
        entries.push({
          ts,
          agentId: event.agentId,
          agentName: meta.name,
          agentRole: meta.role,
          kind: "error",
          message: event.message ?? "hit an error",
        });
        break;
      }

      case "action.start": {
        const meta = agentMeta(event.agentId, agents, spawnCache);
        entries.push({
          ts,
          agentId: event.agentId,
          agentName: meta.name,
          agentRole: meta.role,
          kind: "tool_start",
          action: event.action,
          detail: event.detail,
        });
        break;
      }

      case "action.end": {
        const meta = agentMeta(event.agentId, agents, spawnCache);
        entries.push({
          ts,
          agentId: event.agentId,
          agentName: meta.name,
          agentRole: meta.role,
          kind: "tool_end",
          action: event.action,
          detail: event.detail,
        });
        break;
      }

      case "blocker.hit": {
        const meta = agentMeta(event.agentId, agents, spawnCache);
        entries.push({
          ts,
          agentId: event.agentId,
          agentName: meta.name,
          agentRole: meta.role,
          kind: "blocked",
          detail: event.detail ?? "unknown reason",
        });
        break;
      }

      case "raw.stdout":
      case "raw.stderr": {
        try {
          const decoded = atob(event.data);
          const clean = decoded.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
          if (clean.length === 0) break;
          const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
          const meta = agentMeta(event.agentId, agents, spawnCache);
          for (const line of lines.slice(0, 5)) {
            entries.push({
              ts,
              agentId: event.agentId,
              agentName: meta.name,
              agentRole: meta.role,
              kind: "tool_end",
              action: event.type === "raw.stderr" ? "stderr" : "stdout",
              detail: line.slice(0, 200),
            });
          }
        } catch { /* ignore */ }
        break;
      }

      default:
        break;
    }
  }

  if (entries.length > MAX_TRANSCRIPT) {
    return entries.slice(-MAX_TRANSCRIPT);
  }
  return entries;
}

/** Rebuild timeline segments from the event ring (lazy — only when Timeline is open). */
export function deriveTimeline(
  events: GameEvent[],
  agents: Map<string, AgentState>,
): TimelineSegment[] {
  const spawnCache = new Map<string, { name: string; role: string }>();
  const open = new Map<string, TimelineSegment>();
  const segments: TimelineSegment[] = [];

  for (const event of events) {
    const ts = "ts" in event && event.ts != null ? event.ts : Date.now();

    switch (event.type) {
      case "agent.spawn":
        spawnCache.set(event.agentId, { name: event.name, role: event.role });
        break;

      case "action.start": {
        const prev = open.get(event.agentId);
        if (prev) prev.endTs = ts;
        const cached = spawnCache.get(event.agentId);
        const live = agents.get(event.agentId);
        const seg: TimelineSegment = {
          agentId: event.agentId,
          agentName: live?.name ?? cached?.name ?? event.agentId,
          agentRole: live?.role ?? cached?.role ?? "warrior",
          action: event.action,
          detail: event.detail,
          startTs: ts,
        };
        open.set(event.agentId, seg);
        segments.push(seg);
        break;
      }

      case "action.end": {
        const prev = open.get(event.agentId);
        if (prev) {
          prev.endTs = ts;
          open.delete(event.agentId);
        }
        break;
      }

      case "agent.complete": {
        const prev = open.get(event.agentId);
        if (prev) {
          prev.endTs = ts;
          open.delete(event.agentId);
        }
        break;
      }

      default:
        break;
    }
  }

  return segments;
}
