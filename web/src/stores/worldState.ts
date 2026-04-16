import { create } from "zustand";

/**
 * WorldState — tracks persistent world data across sessions.
 *
 * Each completed session becomes a "wing" in the world map.
 * Past sessions are rendered as ancient ruins (desaturated, crumbling).
 */

export interface SessionWing {
  sessionId: string;
  name: string;
  startedAt: number; // epoch ms
  endedAt: number;
  agentCount: number;
  taskCount: number;
  status: "running" | "completed" | "failed";
  /** World position — assigned on first appearance */
  worldX: number;
  worldY: number;
  /** Summary stats */
  totalXP: number;
  totalGold: number;
  totalTokens: number;
}

interface WorldState {
  sessions: SessionWing[];
  currentSessionId: string | null;
  showWorldMap: boolean;

  setCurrentSession: (id: string) => void;
  addSession: (wing: SessionWing) => void;
  toggleWorldMap: () => void;
  loadFromStorage: () => void;
  saveToStorage: () => void;
}

const WORLD_STORAGE_KEY = "cli_dm_world_state";

export const useWorldState = create<WorldState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  showWorldMap: false,

  setCurrentSession: (id) => set({ currentSessionId: id }),

  addSession: (wing) => {
    const sessions = [...get().sessions];
    const existing = sessions.findIndex((s) => s.sessionId === wing.sessionId);
    if (existing >= 0) {
      sessions[existing] = wing;
    } else {
      // Assign world position based on session count
      const count = sessions.length;
      const angle = (count * 137.5 * Math.PI) / 180; // golden angle spiral
      const radius = 300 + count * 80;
      wing.worldX = Math.cos(angle) * radius;
      wing.worldY = Math.sin(angle) * radius;
      sessions.push(wing);
    }
    set({ sessions });
    get().saveToStorage();
  },

  toggleWorldMap: () => set({ showWorldMap: !get().showWorldMap }),

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(WORLD_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as SessionWing[];
      set({ sessions: data });
    } catch { /* ignore corrupt data */ }
  },

  saveToStorage: () => {
    try {
      const { sessions } = get();
      localStorage.setItem(WORLD_STORAGE_KEY, JSON.stringify(sessions));
    } catch { /* quota exceeded */ }
  },
}));
