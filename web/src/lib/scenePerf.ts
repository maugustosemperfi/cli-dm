/** Dev/prod-soak metrics for Pixi scene sync tiers (Phase 0). */

export type SyncTier = "T0" | "T1" | "T2" | "T3" | "dag";

export interface SceneCounts {
  rooms: number;
  sprites: number;
  corridors: number;
  creatures: number;
}

export interface ScenePerfSnapshot {
  tiersPerMin: Record<SyncTier, number>;
  totalPerMin: number;
  scene: SceneCounts | null;
  jsHeapMB: number | null;
}

const WINDOW_MS = 60_000;

const tierCounts: Record<SyncTier, number> = {
  T0: 0,
  T1: 0,
  T2: 0,
  T3: 0,
  dag: 0,
};

let windowStart = Date.now();
let sceneCounts: SceneCounts | null = null;

function maybeRollWindow() {
  const now = Date.now();
  if (now - windowStart >= WINDOW_MS) {
    for (const k of Object.keys(tierCounts) as SyncTier[]) tierCounts[k] = 0;
    windowStart = now;
  }
}

export function recordSyncTier(tier: SyncTier) {
  maybeRollWindow();
  tierCounts[tier]++;
}

export function setSceneCounts(counts: SceneCounts) {
  sceneCounts = counts;
}

export function getScenePerfSnapshot(): ScenePerfSnapshot {
  maybeRollWindow();
  const elapsedMin = Math.max((Date.now() - windowStart) / WINDOW_MS, 1 / 60);
  const tiersPerMin = {} as Record<SyncTier, number>;
  let total = 0;
  for (const k of Object.keys(tierCounts) as SyncTier[]) {
    tiersPerMin[k] = Math.round(tierCounts[k] / elapsedMin);
    total += tierCounts[k];
  }
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
  const jsHeapMB =
    perf.memory != null ? Math.round(perf.memory.usedJSHeapSize / 1024 / 1024) : null;

  return {
    tiersPerMin,
    totalPerMin: Math.round(total / elapsedMin),
    scene: sceneCounts,
    jsHeapMB,
  };
}

export function isPerfOverlayEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    return localStorage.getItem("cli-dm-perf") === "1";
  } catch {
    return false;
  }
}

export function setPerfOverlayEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem("cli-dm-perf", "1");
    else localStorage.removeItem("cli-dm-perf");
  } catch {
    /* ignore */
  }
}
