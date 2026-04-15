# 2D Grid Dungeon Layout + Discovery Doors

## Context

Currently all rooms stack in a single vertical column (Sugiyama layout) with no corridors visible between independent agents. The goal is a proper dungeon: rooms in a 2D grid, corridors in all 4 directions, characters walking through hallways and discovering doors (new files/folders).

## Changes

### 1. Grid Layout (`layout.ts`)

Replace Sugiyama column with a 2D grid:
- `cols = ceil(sqrt(N))`, `rows = ceil(N / cols)` → roughly square grid
- When DAG edges exist: use depth as column, index as row (preserves left-to-right flow)
- Add `gridCol`, `gridRow` to `LayoutNode`; add `gridCols`, `gridRows` to `LayoutResult`
- New constants in `theme.ts`: `GRID_COL_SPACING = 350`, `GRID_ROW_SPACING = 250`

### 2. 4-Directional Corridors (`DungeonMap.tsx`)

Replace proximity corridor logic with grid adjacency:
```
For each room at (col, row):
  Check rooms at (col±1, row) and (col, row±1)
  Create corridor if room exists and not already connected
```
All agents get up to 4 neighbors for wandering.

### 3. Discovery Doors (new `DiscoveryDoor.ts`)

**Trigger:** `action.start` with `read`/`edit` — extract parent directory from `event.detail`. If directory is new for that agent, spawn a door.

**Tracking:** Add `discoveredPaths: Set<string>` and `discoveredPathCount: number` to `AgentState` in `gameState.ts`.

**Visual:** Wooden door frame with swinging panels, nameplate showing directory name (last 2 segments), golden glow. States: closed → opening → open (lingers 5s, fades).

**Clutter cap:** Max 3 doors per agent. Oldest force-faded when 4th spawns.

**Placement:** On corridor midpoint nearest to agent's room. Picked from a neighbor corridor the agent hasn't visited recently.

### 4. Files to Change

| File | Change |
|------|--------|
| `web/src/components/DungeonMap/layout.ts` | Rewrite `computeLayout()` to grid |
| `web/src/components/DungeonMap/theme.ts` | Add `GRID_COL_SPACING`, `GRID_ROW_SPACING`, discovery door colors |
| `web/src/components/DungeonMap/DungeonMap.tsx` | Grid corridor connectivity, discovery door spawning/ticking |
| `web/src/stores/gameState.ts` | `discoveredPaths` + `discoveredPathCount` in AgentState, directory extraction in action.start |
| `web/src/components/DungeonMap/DiscoveryDoor.ts` | **New** — door visual class (modeled on BlockedDoor.ts) |

### 5. Verification

```bash
cd ~/dev/nu/cli-dm
# 1. Type-check
cd web && npx tsc --noEmit
# 2. Go build
cd .. && go build ./...
# 3. Visual: rooms should appear in a grid (not a column)
# 4. Corridors visible in all 4 directions between rooms
# 5. Characters wander through corridors left/right/up/down
# 6. When agent reads a file, a discovery door appears on a nearby corridor
```
