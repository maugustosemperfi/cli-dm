import type { GameEvent } from "../protocol/events";

export const EVENT_RING_CAPACITY = 2000;

export function appendToRing(ring: GameEvent[], event: GameEvent): GameEvent[] {
  const next = ring.length >= EVENT_RING_CAPACITY
    ? [...ring.slice(1), event]
    : [...ring, event];
  return next;
}

export function pruneRing(ring: GameEvent[], cutoffTs: number): GameEvent[] {
  return ring.filter((e) => {
    const ts = "ts" in e && e.ts != null ? e.ts : 0;
    return ts >= cutoffTs;
  });
}
